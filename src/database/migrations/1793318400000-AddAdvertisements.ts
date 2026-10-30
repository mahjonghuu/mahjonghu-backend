import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds independent image advertisements with inclusive date-only schedules. */
export class AddAdvertisements1793318400000 implements MigrationInterface {
  name = 'AddAdvertisements1793318400000';

  /** Adds the table without modifying existing operational or booking records. */
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE advertisements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title varchar(80) NOT NULL,
        image_url text NOT NULL,
        starts_on date NOT NULL,
        ends_on date NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT advertisements_title_ck CHECK (length(btrim(title)) > 0),
        CONSTRAINT advertisements_schedule_ck CHECK (ends_on >= starts_on)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX advertisements_created_idx ON advertisements (created_at DESC, id ASC)
    `);
  }

  /** Drops advertisement references; external Storage objects are intentionally not deleted. */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE advertisements');
  }
}
