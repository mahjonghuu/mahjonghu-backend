import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Moves consistent table rates to their outlet without changing booking snapshots. */
export class MovePricingToOutlets1792108800000 implements MigrationInterface {
  name = 'MovePricingToOutlets1792108800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Block legacy table writes between the consistency check and the transfer.
    await queryRunner.query(`LOCK TABLE mahjong_tables IN SHARE MODE`);
    // Check every table, including archived ones, before choosing a shared rate.
    await queryRunner.query(`
      DO $$
      DECLARE conflicting_outlet record;
      BEGIN
        SELECT o.id, o.name INTO conflicting_outlet
        FROM outlets o JOIN mahjong_tables t ON t.outlet_id = o.id
        GROUP BY o.id, o.name
        HAVING count(DISTINCT t.hourly_rate_idr) > 1
        LIMIT 1;
        IF FOUND THEN
          RAISE EXCEPTION 'Cannot migrate pricing for outlet "%" (%): tables have different hourly rates. Align every table rate in this outlet before retrying.',
            conflicting_outlet.name, conflicting_outlet.id;
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE outlets
        ADD COLUMN hourly_rate_idr bigint NOT NULL DEFAULT 75000
          CONSTRAINT outlets_hourly_rate_idr_ck CHECK (hourly_rate_idr > 0),
        ADD COLUMN rate_tiers jsonb NOT NULL DEFAULT '[]'::jsonb
          CONSTRAINT outlets_rate_tiers_ck CHECK (
            jsonb_typeof(rate_tiers) = 'array' AND jsonb_array_length(rate_tiers) <= 9
          )
    `);
    await queryRunner.query(`
      UPDATE outlets o SET hourly_rate_idr = t.hourly_rate_idr
      FROM (SELECT DISTINCT ON (outlet_id) outlet_id, hourly_rate_idr
            FROM mahjong_tables ORDER BY outlet_id, id) t
      WHERE t.outlet_id = o.id
    `);
    await queryRunner.query(`
      ALTER TABLE mahjong_tables DROP COLUMN hourly_rate_idr
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE mahjong_tables
        ADD COLUMN hourly_rate_idr bigint NOT NULL DEFAULT 75000
          CONSTRAINT mahjong_tables_hourly_rate_idr_check CHECK (hourly_rate_idr > 0)
    `);
    await queryRunner.query(`
      UPDATE mahjong_tables t SET hourly_rate_idr = o.hourly_rate_idr
      FROM outlets o WHERE o.id = t.outlet_id
    `);
    await queryRunner.query(`
      ALTER TABLE mahjong_tables ALTER COLUMN hourly_rate_idr DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE outlets DROP COLUMN hourly_rate_idr, DROP COLUMN rate_tiers
    `);
  }
}
