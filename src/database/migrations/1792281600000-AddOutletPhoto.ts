import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Stores one optional inline photo without changing existing outlet records. */
export class AddOutletPhoto1792281600000 implements MigrationInterface {
  name = 'AddOutletPhoto1792281600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE outlets ADD COLUMN photo text');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE outlets DROP COLUMN photo');
  }
}
