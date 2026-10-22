import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Makes outlet pricing modes exclusive while allowing mixed hourly booking totals. */
export class AddHappyHourPricing1792195200000 implements MigrationInterface {
  name = 'AddHappyHourPricing1792195200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE FUNCTION valid_outlet_happy_hour(config jsonb) RETURNS boolean
      LANGUAGE plpgsql IMMUTABLE AS $$
      DECLARE day_value jsonb;
      DECLARE day_count integer := 0;
      DECLARE seen_days integer[] := '{}';
      BEGIN
        IF config IS NULL OR jsonb_typeof(config) <> 'object' OR
           (SELECT count(*) FROM jsonb_object_keys(config)) <> 4 OR
           NOT (config ?& ARRAY['days', 'startHour', 'endHour', 'rate']) OR
           jsonb_typeof(config->'days') <> 'array' OR
           jsonb_typeof(config->'startHour') <> 'number' OR
           jsonb_typeof(config->'endHour') <> 'number' OR
           jsonb_typeof(config->'rate') <> 'number' THEN
          RETURN false;
        END IF;
        IF (config->>'startHour')::numeric NOT BETWEEN 0 AND 23 OR
           (config->>'startHour')::numeric <> trunc((config->>'startHour')::numeric) OR
           (config->>'endHour')::numeric NOT BETWEEN 1 AND 24 OR
           (config->>'endHour')::numeric <> trunc((config->>'endHour')::numeric) OR
           (config->>'endHour')::numeric <= (config->>'startHour')::numeric OR
           (config->>'rate')::numeric NOT BETWEEN 1 AND 1000000000 OR
           (config->>'rate')::numeric <> trunc((config->>'rate')::numeric) THEN
          RETURN false;
        END IF;
        FOR day_value IN SELECT value FROM jsonb_array_elements(config->'days') LOOP
          IF jsonb_typeof(day_value) <> 'number' THEN RETURN false; END IF;
          IF (day_value #>> '{}')::numeric NOT BETWEEN 1 AND 7 OR
             (day_value #>> '{}')::numeric <> trunc((day_value #>> '{}')::numeric) OR
             (day_value #>> '{}')::integer = ANY(seen_days) THEN
            RETURN false;
          END IF;
          seen_days := array_append(seen_days, (day_value #>> '{}')::integer);
          day_count := day_count + 1;
        END LOOP;
        RETURN day_count BETWEEN 1 AND 7;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE outlets
        ADD COLUMN pricing_mode varchar(10) NOT NULL DEFAULT 'duration'
          CONSTRAINT outlets_pricing_mode_ck CHECK (pricing_mode IN ('duration', 'happy_hour')),
        ADD COLUMN happy_hour jsonb,
        ADD CONSTRAINT outlets_pricing_config_ck CHECK (
          (pricing_mode = 'duration' AND happy_hour IS NULL) OR
          (pricing_mode = 'happy_hour' AND happy_hour IS NOT NULL
           AND jsonb_array_length(rate_tiers) = 0
           AND valid_outlet_happy_hour(happy_hour))
        )
    `);
    await queryRunner.query(`
      ALTER TABLE bookings DROP CONSTRAINT bookings_total_ck,
        ADD CONSTRAINT bookings_total_ck CHECK (total_amount_idr <= duration_hours::bigint * 1000000000)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE bookings DROP CONSTRAINT bookings_total_ck,
        ADD CONSTRAINT bookings_total_ck CHECK (total_amount_idr = hourly_rate_idr * duration_hours)
    `);
    await queryRunner.query(`ALTER TABLE outlets DROP COLUMN pricing_mode, DROP COLUMN happy_hour`);
    await queryRunner.query(`DROP FUNCTION valid_outlet_happy_hour(jsonb)`);
  }
}
