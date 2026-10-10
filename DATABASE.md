# Database design

## Status and scope

This is the **proposed PostgreSQL schema**, now encoded in the unapplied TypeORM migration [`src/database/migrations/1791590400000-InitialSchema.ts`](src/database/migrations/1791590400000-InitialSchema.ts). The backend connects through NestJS/TypeORM with `synchronize: false`; there are no application entities yet. Apply migrations explicitly before connecting the frontend to the backend. The frontend PoC in `../mahjonghu-web/app/dashboard/model.ts` uses three in-memory lists: outlets, tables, and _already paid_ transactions. The schema below also models users and bookings for authenticated customers and the business dashboard; public guests can book without an account. Do not treat the PoC's editable table status as evidence of a real booking or payment.

## Relationships

```mermaid
erDiagram
  outlets ||--o{ mahjong_tables : contains
  users |o--o{ bookings : places
  outlets ||--o{ bookings : receives
  mahjong_tables ||--o{ bookings : reserved_for
  bookings ||--o{ payments : settled_by
  payments ||--o{ payments : refunded_by
```

| Table            | Purpose and important columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`          | `id` UUID PK; `auth_subject` unique ID from the authentication provider; `email` unique case-insensitively; `role` (`customer`, `owner`); `is_active`, audit timestamps. Public booking does not require an account. Only owners access the business dashboard. Do not store passwords or session tokens in this table.                                                                                                                                                                                               |
| `outlets`        | `id` UUID PK; `name` and `city` varchar(80); `address` varchar(240); `timezone` IANA name (default `Asia/Jakarta`); `is_active` boolean; `archived_at`, `created_at`, `updated_at` timestamptz. Active names are unique case-insensitively.                                                                                                                                                                                                                                                                           |
| `mahjong_tables` | `id` UUID PK; `outlet_id` FK; `name` varchar(80), `hourly_rate_idr` positive bigint, `condition` (`available`, `maintenance`), `archived_at`, audit timestamps. Active table names are unique within an outlet. There is no manually editable `in_use` flag: it is derived from an `in_progress` booking.                                                                                                                                                                                                             |
| `bookings`       | `id` UUID PK; nullable `user_id` FK for an authenticated customer (guest bookings have no user); `outlet_id` and `table_id` (joint FK to the table's outlet); public `reference` unique; `customer_name` varchar(120), `customer_contact` varchar(160); `starts_at`, `ends_at` UTC instants; `duration_hours` positive integer; `hourly_rate_idr` and `total_amount_idr` price snapshots; `status` (`pending`, `confirmed`, `in_progress`, `completed`, `cancelled`, `expired`); `hold_expires_at`, audit timestamps. |
| `payments`       | `id` UUID PK; `booking_id` FK; `kind` (`charge`, `refund`), `status` (`pending`, `succeeded`, `failed`); `amount_idr` positive bigint; `provider`, `provider_reference`, `idempotency_key`; `original_payment_id` for refunds; `settled_at`, audit timestamps. One row per charge/refund attempt, not a mutable booking total.                                                                                                                                                                                        |

All money is **whole Indonesian rupiah (IDR)** stored as `bigint`; never floating point. Identifiers remain stable across renames. All timestamps are `timestamptz`, stored as instants; use an outlet's `timezone` only for displaying and grouping local calendar dates. No precomputed dashboard totals or independent transaction table is required: successful payment rows are the financial source of truth.

## Proposed migration DDL

The following DDL describes the initial TypeORM migration; **do not run this SQL separately** if using the migration. PostgreSQL's `btree_gist` extension provides the overlapping-booking exclusion rule. The example uses `gen_random_uuid()` (available in supported PostgreSQL versions); if the target server does not expose it, enable `pgcrypto` in the migration. Confirm extension privileges in the deployment environment. The migration rollback drops only its tables in reverse dependency order and leaves `btree_gist` installed, since it may have existed before or be used elsewhere.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject varchar(160) NOT NULL UNIQUE,
  email varchar(254) NOT NULL,
  role varchar(10) NOT NULL DEFAULT 'customer'
    CHECK (role IN ('customer', 'owner')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(btrim(email)));

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
);
CREATE UNIQUE INDEX outlets_active_name_uq
  ON outlets (lower(btrim(name))) WHERE archived_at IS NULL;

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
);
CREATE UNIQUE INDEX tables_active_name_per_outlet_uq
  ON mahjong_tables (outlet_id, lower(btrim(name))) WHERE archived_at IS NULL;
CREATE INDEX tables_outlet_idx ON mahjong_tables (outlet_id);

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
);
-- Half-open ranges allow one booking to end when the next starts.
-- Pending payment holds also reserve the slot until changed to expired/cancelled.
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    table_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('pending', 'confirmed', 'in_progress'));
CREATE INDEX bookings_outlet_start_idx ON bookings (outlet_id, starts_at);
CREATE INDEX bookings_table_start_idx ON bookings (table_id, starts_at);
CREATE INDEX bookings_pending_expiry_idx ON bookings (hold_expires_at)
  WHERE status = 'pending';

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
);
CREATE UNIQUE INDEX payments_provider_reference_uq
  ON payments (provider, provider_reference) WHERE provider_reference IS NOT NULL;
CREATE INDEX payments_booking_idx ON payments (booking_id);
CREATE INDEX payments_settled_idx ON payments (settled_at, booking_id)
  WHERE status = 'succeeded';

```

## Lifecycle and integrity rules

1. **Outlets and tables:** do not physically delete records referenced by bookings/payments. Archive them using `archived_at`; inactive outlets are hidden from new public bookings, but remain visible in historical reports. The application must reject deactivating/archiving an outlet with an `in_progress` booking and reject maintenance/archival of an occupied table. Do not change a table's `outlet_id` once bookings exist (prefer never moving tables; create a new table at the destination). Validate `timezone` against IANA time zones and normalize names by trimming before writing.
2. **Availability:** public booking may select only active, unarchived outlets and unarchived tables in `available` condition. Check these rules and insert the `pending` booking in one database transaction. The exclusion constraint is the final defense against concurrent overlapping reservations; handle its conflict as a booking-unavailable response. `pending` is a temporary hold with `hold_expires_at`; expire overdue holds in a worker/transaction **before** accepting a new reservation for that slot. The exclusion constraint does not automatically ignore an elapsed hold. A real `in_use` dashboard status comes from an `in_progress` booking; a table in `maintenance` must not have one. Restrict legal status transitions in the service (e.g. `pending` → `confirmed` after payment, `confirmed` → `in_progress` → `completed`; cancellation/expiration releases slots).
3. **Prices and payments:** snapshot the rate and agreed hours on booking creation; editing the current table rate must not rewrite historical revenue. Verify signed payment provider callbacks; process them idempotently using `provider_reference` / `idempotency_key` in a transaction and lock the booking and relevant payment rows. Only record `succeeded` after settlement. Reject or refund a successful callback for an expired/cancelled booking as appropriate; never silently re-confirm a slot that was released. Refunds must refer to a succeeded charge for the **same booking**; verify in the service that cumulative succeeded refunds cannot exceed that charge. The parent FK guarantees the same booking but cannot guarantee `kind` or the cumulative sum. Never generate a paid row by simply changing table status.
4. **Authorization and privacy:** public guests can create bookings with separate public-specific validation and rate/abuse controls. Authenticated `customer` users can access only their own bookings (`bookings.user_id`); never allow a client to choose or change this ID independently of its authenticated identity. The business dashboard, outlet/table management, internal booking management and financial reports require an active `owner` role verified on the server. There is no per-outlet access table: owners can manage all outlets. Only trusted server-side provisioning can grant or change the `owner` role; public sign-up always creates `customer` users. Never trust browser-supplied roles or outlet filters for authorization. Restrict access to `customer_contact`, do not include it in CSV exports, and define retention/deletion handling before handling real customer data. The in-memory demo's `Admin Demo` avatar does not represent a real user account.
5. **Updates:** set `updated_at` on every write in application logic or a database trigger (the column default only handles inserts). Apply status changes and relevant validations in transactions to avoid races with booking and payment callbacks. Never use `synchronize: true` against an existing database; use reviewed forward migrations, with a rollback/recovery plan for destructive changes.

## Revenue and dashboard mapping

Revenue is **net settled cash flow**: each succeeded `charge` contributes `+amount_idr` and each succeeded `refund` contributes `-amount_idr`, grouped by its own `settled_at` local date at the booking's outlet. Failed/pending attempts contribute nothing. This is a deliberate cash-basis convention; recognition by play date would be a separate report. Booking payment attempts and refunds can produce multiple report rows for one booking. The PoC's 24 sample transactions represent 24 successful charges with no refunds; their `date`, `hours`, `amount`, `customer`, and outlet/table IDs map respectively to settlement date, booking duration, payment amount, booking customer name, and booking foreign keys. PoC transaction IDs can be treated as display/payment references, not UUID primary keys.

Use the same outlet and inclusive local-date filters for the summary, per-outlet totals, transaction list, and CSV. For a single outlet, convert local `[from_date 00:00, (to_date + 1) 00:00)` using its IANA timezone to UTC before filtering `payments.settled_at`; for an all-outlet report, apply **each** outlet's timezone when selecting local dates. Do not filter via UTC date alone, especially across midnight or mixed timezones. Include archived outlets in historical revenue, but count only active, unarchived outlets in the current outlet metric. Distinct successful charges/refunds are rows in the financial breakdown; a separate count of paid bookings should count distinct booking IDs with at least one succeeded charge rather than payment attempts. Current table status, availability, and the number of occupied tables come from `mahjong_tables` plus `bookings.status = 'in_progress'`, not from payments. Server responses should compute these metrics, not persist redundant counters.

The initial migration creates `users` → `outlets` → `mahjong_tables` → `bookings` → `payments`, followed by their constraints and indexes; seed demo data separately from production data. Replace the PoC's in-memory records only after authenticated endpoints, booking concurrency handling, and payment integration are implemented.
