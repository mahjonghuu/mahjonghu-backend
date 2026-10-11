import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds bcrypt password hashes for backend-provisioned owner accounts. */
export class AddPasswordHashToUsers1791676800000 implements MigrationInterface {
  name = 'AddPasswordHashToUsers1791676800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN password_hash varchar(100)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN password_hash`);
  }
}
