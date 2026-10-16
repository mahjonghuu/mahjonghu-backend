import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds customer email challenges and outlet membership without changing existing public outlets. */
export class AddPrivateOutletAccess1791936000000 implements MigrationInterface {
  name = 'AddPrivateOutletAccess1791936000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE outlets ADD COLUMN visibility varchar(7) NOT NULL DEFAULT 'public'
        CHECK (visibility IN ('public', 'private'))
    `);
    await queryRunner.query(`
      CREATE TABLE outlet_access (
        outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (outlet_id, user_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX outlet_access_user_idx ON outlet_access (user_id, outlet_id)`,
    );
    await queryRunner.query(`
      CREATE TABLE customer_otp (
        email varchar(254) PRIMARY KEY,
        code_hash varchar(64) NOT NULL,
        expires_at timestamptz NOT NULL,
        last_sent_at timestamptz NOT NULL,
        window_start timestamptz NOT NULL,
        request_count smallint NOT NULL DEFAULT 1,
        failed_attempts smallint NOT NULL DEFAULT 0,
        consumed_at timestamptz
      )
    `);
    await queryRunner.query(`
      CREATE TABLE customer_otp_ip_limits (
        ip_hash varchar(64) PRIMARY KEY,
        window_start timestamptz NOT NULL,
        request_count smallint NOT NULL DEFAULT 1
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE customer_otp_ip_limits`);
    await queryRunner.query(`DROP TABLE customer_otp`);
    await queryRunner.query(`DROP TABLE outlet_access`);
    await queryRunner.query(`ALTER TABLE outlets DROP COLUMN visibility`);
  }
}
