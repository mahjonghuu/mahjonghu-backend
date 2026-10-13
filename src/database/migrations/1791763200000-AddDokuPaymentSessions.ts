import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Persists aggregate DOKU orders and links their charges to held bookings. */
export class AddDokuPaymentSessions1791763200000 implements MigrationInterface {
  name = 'AddDokuPaymentSessions1791763200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE payment_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_number varchar(30) NOT NULL UNIQUE,
        environment varchar(10) NOT NULL CHECK (environment IN ('dev', 'prod')),
        status varchar(20) NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'expired')),
        customer_name varchar(120) NOT NULL CHECK (length(btrim(customer_name)) > 0),
        customer_phone varchar(32) NOT NULL CHECK (length(btrim(customer_phone)) > 0),
        customer_email varchar(254) NOT NULL CHECK (length(btrim(customer_email)) > 0),
        amount_idr bigint NOT NULL CHECK (amount_idr > 0),
        checkout_url text,
        doku_session_id varchar(160),
        expires_at timestamptz NOT NULL,
        notification_request_id varchar(128) UNIQUE,
        settled_at timestamptz,
        reservation_needs_review boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE payment_session_bookings (
        payment_session_id uuid NOT NULL REFERENCES payment_sessions(id) ON DELETE RESTRICT,
        booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
        PRIMARY KEY (payment_session_id, booking_id),
        UNIQUE (booking_id)
      )
    `);
    await queryRunner.query(
      `ALTER TABLE payments ADD COLUMN payment_session_id uuid REFERENCES payment_sessions(id) ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `CREATE INDEX payment_sessions_expiry_idx ON payment_sessions (expires_at) WHERE status = 'pending'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE payments DROP COLUMN payment_session_id`);
    await queryRunner.query(`DROP TABLE payment_session_bookings`);
    await queryRunner.query(`DROP TABLE payment_sessions`);
  }
}
