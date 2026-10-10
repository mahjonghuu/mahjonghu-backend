import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Creates the initial booking and payment schema specified in DATABASE.md. */
export class InitialSchema1791590400000 implements MigrationInterface {
  name = 'InitialSchema1791590400000';

  /** Applies the schema in foreign-key dependency order within TypeORM's migration transaction. */
  async up(queryRunner: QueryRunner): Promise<void> {
    // btree_gist provides equality for UUID keys in the exclusion constraint.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);

    await queryRunner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        auth_subject varchar(160) NOT NULL UNIQUE,
        email varchar(254) NOT NULL,
        role varchar(10) NOT NULL DEFAULT 'customer'
          CHECK (role IN ('customer', 'owner')),
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX users_email_uq ON users (lower(btrim(email)))`,
    );

    await queryRunner.query(`
      CREATE TABLE outlets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(80) NOT NULL CHECK (length(btrim(name)) > 0),
        city varchar(80) NOT NULL CHECK (length(btrim(city)) > 0),
        address varchar(240) NOT NULL CHECK (length(btrim(address)) > 0),
        timezone varchar(64) NOT NULL DEFAULT 'Asia/Jakarta',
        is_active boolean NOT NULL DEFAULT true,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX outlets_active_name_uq
        ON outlets (lower(btrim(name))) WHERE archived_at IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE mahjong_tables (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
        name varchar(80) NOT NULL CHECK (length(btrim(name)) > 0),
        hourly_rate_idr bigint NOT NULL CHECK (hourly_rate_idr > 0),
        condition varchar(20) NOT NULL DEFAULT 'available'
          CHECK (condition IN ('available', 'maintenance')),
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (id, outlet_id)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX tables_active_name_per_outlet_uq
        ON mahjong_tables (outlet_id, lower(btrim(name))) WHERE archived_at IS NULL
    `);
    await queryRunner.query(
      `CREATE INDEX tables_outlet_idx ON mahjong_tables (outlet_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE bookings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reference varchar(40) NOT NULL UNIQUE,
        outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
        table_id uuid NOT NULL,
        user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        customer_name varchar(120) NOT NULL CHECK (length(btrim(customer_name)) > 0),
        customer_contact varchar(160) NOT NULL CHECK (length(btrim(customer_contact)) > 0),
        starts_at timestamptz NOT NULL,
        ends_at timestamptz NOT NULL,
        duration_hours integer NOT NULL CHECK (duration_hours > 0),
        hourly_rate_idr bigint NOT NULL CHECK (hourly_rate_idr > 0),
        total_amount_idr bigint NOT NULL CHECK (total_amount_idr > 0),
        status varchar(20) NOT NULL CHECK (status IN
          ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'expired')),
        hold_expires_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT bookings_table_outlet_fk FOREIGN KEY (table_id, outlet_id)
          REFERENCES mahjong_tables(id, outlet_id) ON DELETE RESTRICT,
        CONSTRAINT bookings_times_ck CHECK (ends_at > starts_at),
        CONSTRAINT bookings_duration_ck CHECK
          (EXTRACT(EPOCH FROM ends_at - starts_at) = duration_hours * 3600),
        CONSTRAINT bookings_total_ck CHECK
          (total_amount_idr = hourly_rate_idr * duration_hours),
        CONSTRAINT bookings_pending_hold_ck CHECK
          (status <> 'pending' OR
            (hold_expires_at IS NOT NULL AND hold_expires_at > created_at))
      )
    `);
    // Half-open intervals allow back-to-back bookings; a pending hold also blocks the slot.
    await queryRunner.query(`
      ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
        EXCLUDE USING gist (
          table_id WITH =,
          tstzrange(starts_at, ends_at, '[)') WITH &&
        ) WHERE (status IN ('pending', 'confirmed', 'in_progress'))
    `);
    await queryRunner.query(
      `CREATE INDEX bookings_outlet_start_idx ON bookings (outlet_id, starts_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX bookings_table_start_idx ON bookings (table_id, starts_at)`,
    );
    await queryRunner.query(`
      CREATE INDEX bookings_pending_expiry_idx ON bookings (hold_expires_at)
        WHERE status = 'pending'
    `);

    await queryRunner.query(`
      CREATE TABLE payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
        kind varchar(10) NOT NULL CHECK (kind IN ('charge', 'refund')),
        status varchar(10) NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
        amount_idr bigint NOT NULL CHECK (amount_idr > 0),
        provider varchar(80) NOT NULL CHECK (length(btrim(provider)) > 0),
        provider_reference varchar(160),
        idempotency_key varchar(160) NOT NULL UNIQUE,
        original_payment_id uuid,
        settled_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (id, booking_id),
        CONSTRAINT payments_refund_parent_fk FOREIGN KEY (original_payment_id, booking_id)
          REFERENCES payments(id, booking_id) ON DELETE RESTRICT,
        CONSTRAINT payments_refund_parent_ck CHECK
          ((kind = 'refund') = (original_payment_id IS NOT NULL)),
        CONSTRAINT payments_settlement_ck CHECK
          ((status = 'succeeded') = (settled_at IS NOT NULL))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX payments_provider_reference_uq
        ON payments (provider, provider_reference) WHERE provider_reference IS NOT NULL
    `);
    await queryRunner.query(
      `CREATE INDEX payments_booking_idx ON payments (booking_id)`,
    );
    await queryRunner.query(`
      CREATE INDEX payments_settled_idx ON payments (settled_at, booking_id)
        WHERE status = 'succeeded'
    `);
  }

  /** Removes only this migration's tables; a pre-existing btree_gist extension is preserved. */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE payments`);
    await queryRunner.query(`DROP TABLE bookings`);
    await queryRunner.query(`DROP TABLE mahjong_tables`);
    await queryRunner.query(`DROP TABLE outlets`);
    await queryRunner.query(`DROP TABLE users`);
    // The extension may have existed before this migration or serve other schemas.
  }
}
