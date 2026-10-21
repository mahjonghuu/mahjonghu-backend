import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Allows midnight and next-day closing hours while prohibiting zero-length hours. */
export class AllowOvernightOutletHours1792022400000 implements MigrationInterface {
  name = 'AllowOvernightOutletHours1792022400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE outlets DROP CONSTRAINT outlets_operating_hours_check`,
    );
    await queryRunner.query(
      `ALTER TABLE outlets DROP CONSTRAINT outlets_closing_hour_check`,
    );
    await queryRunner.query(
      `ALTER TABLE outlets ADD CONSTRAINT outlets_closing_hour_check CHECK (closing_hour >= 0 AND closing_hour <= 24)`,
    );
    await queryRunner.query(
      `ALTER TABLE outlets ADD CONSTRAINT outlets_operating_hours_check CHECK (closing_hour <> opening_hour)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE outlets DROP CONSTRAINT outlets_operating_hours_check`,
    );
    await queryRunner.query(
      `ALTER TABLE outlets DROP CONSTRAINT outlets_closing_hour_check`,
    );
    await queryRunner.query(
      `ALTER TABLE outlets ADD CONSTRAINT outlets_closing_hour_check CHECK (closing_hour >= 1 AND closing_hour <= 24)`,
    );
    await queryRunner.query(
      `ALTER TABLE outlets ADD CONSTRAINT outlets_operating_hours_check CHECK (closing_hour > opening_hour)`,
    );
  }
}
