import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Stores each outlet's inclusive opening and exclusive closing hour. */
export class AddOutletOperatingHours1791849600000 implements MigrationInterface {
  name = 'AddOutletOperatingHours1791849600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE outlets ADD COLUMN opening_hour smallint NOT NULL DEFAULT 12 CHECK (opening_hour >= 0 AND opening_hour <= 23)`,
    );
    await queryRunner.query(
      `ALTER TABLE outlets ADD COLUMN closing_hour smallint NOT NULL DEFAULT 22 CHECK (closing_hour >= 1 AND closing_hour <= 24)`,
    );
    await queryRunner.query(
      `ALTER TABLE outlets ADD CONSTRAINT outlets_operating_hours_check CHECK (closing_hour > opening_hour)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE outlets DROP CONSTRAINT outlets_operating_hours_check`,
    );
    await queryRunner.query(`ALTER TABLE outlets DROP COLUMN closing_hour`);
    await queryRunner.query(`ALTER TABLE outlets DROP COLUMN opening_hour`);
  }
}
