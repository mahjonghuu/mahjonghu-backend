import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds employee accounts that belong to exactly one outlet.
 *
 * Each employee is a `users` row with `role = 'employee'` and a non-null
 * `outlet_id`. The coherence check keeps owners and customers unassigned while
 * allowing any number of employees to share one outlet.
 */
export class AddEmployeeOutletAssignment1794096000000 implements MigrationInterface {
  name = 'AddEmployeeOutletAssignment1794096000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users DROP CONSTRAINT users_role_check`,
    );
    await queryRunner.query(`
      ALTER TABLE users ADD CONSTRAINT users_role_check
        CHECK (role IN ('customer', 'owner', 'employee'))
    `);
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN outlet_id uuid REFERENCES outlets(id) ON DELETE RESTRICT`,
    );
    await queryRunner.query(`
      ALTER TABLE users ADD CONSTRAINT users_role_outlet_ck
        CHECK ((role = 'employee') = (outlet_id IS NOT NULL))
    `);
    await queryRunner.query(
      `CREATE INDEX users_outlet_idx ON users (outlet_id) WHERE outlet_id IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users DROP CONSTRAINT users_role_outlet_ck`,
    );
    await queryRunner.query(`
      UPDATE users
      SET role = 'customer', outlet_id = NULL, is_active = false,
          updated_at = CURRENT_TIMESTAMP
      WHERE role = 'employee'
    `);
    await queryRunner.query(`DROP INDEX users_outlet_idx`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN outlet_id`);
    await queryRunner.query(
      `ALTER TABLE users DROP CONSTRAINT users_role_check`,
    );
    await queryRunner.query(`
      ALTER TABLE users ADD CONSTRAINT users_role_check
        CHECK (role IN ('customer', 'owner'))
    `);
  }
}
