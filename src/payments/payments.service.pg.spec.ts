import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { BookingEntity } from '../bookings/entities/booking.entity.js';
import { BookingsService } from '../bookings/bookings.service.js';
import { InitialSchema1791590400000 } from '../database/migrations/1791590400000-InitialSchema.js';
import { AddDokuPaymentSessions1791763200000 } from '../database/migrations/1791763200000-AddDokuPaymentSessions.js';
import { OutletEntity } from '../outlets/entities/outlet.entity.js';
import type { OutletAccessService } from '../outlets/outlet-access.service.js';
import { TableEntity } from '../tables/entities/table.entity.js';
import type { DokuClientService } from './doku-client.service.js';
import { PaymentEntity } from './entities/payment.entity.js';
import { PaymentSessionEntity } from './entities/payment-session.entity.js';
import { PaymentsService } from './payments.service.js';

const databaseUrl = process.env.PAYMENTS_TEST_DATABASE_URL;
const schema = `payment_test_${randomUUID().replaceAll('-', '')}`;

/** Runs against a dedicated PostgreSQL database when PAYMENTS_TEST_DATABASE_URL is set. */
describe.skipIf(!databaseUrl)('PaymentsService PostgreSQL transitions', () => {
  let admin: DataSource;
  let dataSource: DataSource;

  beforeAll(async () => {
    admin = new DataSource({ type: 'postgres', url: databaseUrl });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    dataSource = new DataSource({
      type: 'postgres',
      url: databaseUrl,
      schema,
      extra: { options: `-c search_path=${schema},public` },
      entities: [
        BookingEntity,
        OutletEntity,
        TableEntity,
        PaymentEntity,
        PaymentSessionEntity,
      ],
      migrations: [
        InitialSchema1791590400000,
        AddDokuPaymentSessions1791763200000,
      ],
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  it('preserves a verified on-time notification and leaves cancelled holds untouched during bulk expiry', async () => {
    const outlet = (await dataSource.query(
      `INSERT INTO outlets (name, city, address) VALUES ('Integration outlet', 'Jakarta', 'Test street') RETURNING id`,
    )) as { id: string }[];
    const expiresAt = new Date(Date.now() - 60_000);
    const settledAt = new Date(expiresAt.getTime() - 60_000);
    const ids: { sessionId: string; bookingId: string; paymentId: string }[] =
      [];

    for (let index = 0; index < 3; index += 1) {
      const table = (await dataSource.query(
        `INSERT INTO mahjong_tables (outlet_id, name, hourly_rate_idr)
         VALUES ($1, $2, 75000) RETURNING id`,
        [outlet[0].id, `Table ${index}`],
      )) as { id: string }[];
      const session = (await dataSource.query(
        `INSERT INTO payment_sessions
         (invoice_number, environment, status, customer_name, customer_phone, customer_email, amount_idr, expires_at)
         VALUES ($1, 'dev', 'pending', 'Guest', '081234567890', 'guest@example.com', 75000, $2)
         RETURNING id`,
        [`MHINTEGRATION${index}`, expiresAt],
      )) as { id: string }[];
      const booking = (await dataSource.query(
        `INSERT INTO bookings
         (reference, outlet_id, table_id, customer_name, customer_contact,
          starts_at, ends_at, duration_hours, hourly_rate_idr, total_amount_idr,
          status, hold_expires_at, created_at)
         VALUES ($1, $2, $3, 'Guest', '081234567890', '2030-01-01T05:00:00Z',
                 '2030-01-01T06:00:00Z', 1, 75000, 75000, 'pending', $4, $5)
         RETURNING id`,
        [
          `MHBOOKING${index}`,
          outlet[0].id,
          table[0].id,
          expiresAt,
          new Date(expiresAt.getTime() - 60_000),
        ],
      )) as { id: string }[];
      await dataSource.query(
        `INSERT INTO payment_session_bookings (payment_session_id, booking_id) VALUES ($1, $2)`,
        [session[0].id, booking[0].id],
      );
      const payment = (await dataSource.query(
        `INSERT INTO payments (booking_id, payment_session_id, kind, status, amount_idr, provider, idempotency_key)
         VALUES ($1, $2, 'charge', 'pending', 75000, 'DOKU_DEV', $3) RETURNING id`,
        [booking[0].id, session[0].id, `integration-${index}`],
      )) as { id: string }[];
      ids.push({
        sessionId: session[0].id,
        bookingId: booking[0].id,
        paymentId: payment[0].id,
      });
    }

    await new BookingsService(
      dataSource.getRepository(BookingEntity),
      dataSource.getRepository(TableEntity),
      dataSource.getRepository(OutletEntity),
      {} as OutletAccessService,
    ).cancel(ids[2].bookingId);

    const service = new PaymentsService(
      dataSource.getRepository(PaymentSessionEntity),
      dataSource,
      {} as DokuClientService,
      {
        allowed: vi.fn().mockResolvedValue(true),
      } as unknown as OutletAccessService,
      {} as ConfigService,
    );
    const lock = dataSource.createQueryRunner();
    await lock.connect();
    await lock.startTransaction();
    try {
      await lock.query(
        'SELECT id FROM payment_sessions WHERE id = $1 FOR UPDATE',
        [ids[0].sessionId],
      );
      const notification = service.handleNotification(
        'dev',
        {
          order: { invoice_number: 'MHINTEGRATION0', amount: 75000 },
          transaction: { status: 'SUCCESS', date: settledAt.toISOString() },
        },
        'integration-notification',
      );
      await service['expireOverdueSessions']();
      const states = (await dataSource.query(
        `SELECT status FROM payment_sessions WHERE id = ANY($1::uuid[]) ORDER BY invoice_number`,
        [ids.map((row) => row.sessionId)],
      )) as { status: string }[];
      expect(states.map((row) => row.status)).toEqual([
        'pending',
        'expired',
        'expired',
      ]);
      await lock.rollbackTransaction();
      await notification;
      await service['expireOverdueSessions']();
    } finally {
      if (lock.isTransactionActive) await lock.rollbackTransaction();
      await lock.release();
    }

    const rows = (await dataSource.query(
      `SELECT s.status AS session_status, b.status AS booking_status, p.status AS payment_status
       FROM payment_sessions s
       JOIN payment_session_bookings psb ON psb.payment_session_id = s.id
       JOIN bookings b ON b.id = psb.booking_id
       JOIN payments p ON p.booking_id = b.id
       ORDER BY s.invoice_number`,
    )) as {
      session_status: string;
      booking_status: string;
      payment_status: string;
    }[];
    expect(rows).toEqual([
      {
        session_status: 'succeeded',
        booking_status: 'confirmed',
        payment_status: 'succeeded',
      },
      {
        session_status: 'expired',
        booking_status: 'expired',
        payment_status: 'failed',
      },
      {
        session_status: 'expired',
        booking_status: 'cancelled',
        payment_status: 'failed',
      },
    ]);
  });

  it('preserves cancelled pending bookings and records later DOKU success for manual review', async () => {
    const outlet = (await dataSource.query(
      `INSERT INTO outlets (name, city, address)
       VALUES ('Cancellation outlet', 'Jakarta', 'Test street') RETURNING id`,
    )) as { id: string }[];
    const table = (await dataSource.query(
      `INSERT INTO mahjong_tables (outlet_id, name, hourly_rate_idr)
       VALUES ($1, 'Cancellation table', 75000) RETURNING id`,
      [outlet[0].id],
    )) as { id: string }[];
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const startsAt = new Date(Date.now() + 2 * 86_400_000);
    const endsAt = new Date(startsAt.getTime() + 3_600_000);
    const session = (await dataSource.query(
      `INSERT INTO payment_sessions
       (invoice_number, environment, status, customer_name, customer_phone, customer_email, amount_idr, expires_at)
       VALUES ('MHCANCELCHECKOUT', 'dev', 'pending', 'Guest', '081234567890', 'guest@example.com', 75000, $1)
       RETURNING id`,
      [expiresAt],
    )) as { id: string }[];
    const booking = (await dataSource.query(
      `INSERT INTO bookings
       (reference, outlet_id, table_id, customer_name, customer_contact,
        starts_at, ends_at, duration_hours, hourly_rate_idr, total_amount_idr,
        status, hold_expires_at)
       VALUES ('MHCANCELBOOKING', $1, $2, 'Guest', '081234567890',
               $3, $4, 1, 75000, 75000, 'pending', $5)
       RETURNING id`,
      [outlet[0].id, table[0].id, startsAt, endsAt, expiresAt],
    )) as { id: string }[];
    await dataSource.query(
      `INSERT INTO payment_session_bookings (payment_session_id, booking_id)
       VALUES ($1, $2)`,
      [session[0].id, booking[0].id],
    );
    await dataSource.query(
      `INSERT INTO payments
       (booking_id, payment_session_id, kind, status, amount_idr, provider, idempotency_key)
       VALUES ($1, $2, 'charge', 'pending', 75000, 'DOKU_DEV', 'cancel-integration')`,
      [booking[0].id, session[0].id],
    );

    const bookings = new BookingsService(
      dataSource.getRepository(BookingEntity),
      dataSource.getRepository(TableEntity),
      dataSource.getRepository(OutletEntity),
      {} as OutletAccessService,
    );
    await expect(bookings.cancel(booking[0].id)).resolves.toEqual({
      id: booking[0].id,
      status: 'cancelled',
    });
    const beforeNotification = (await dataSource.query(
      `SELECT b.status AS booking_status, b.hold_expires_at,
         p.status AS payment_status, s.status AS session_status
       FROM bookings b
       JOIN payments p ON p.booking_id = b.id
       JOIN payment_sessions s ON s.id = p.payment_session_id
       WHERE b.id = $1`,
      [booking[0].id],
    )) as {
      booking_status: string;
      hold_expires_at: Date | null;
      payment_status: string;
      session_status: string;
    }[];
    expect(beforeNotification[0]).toEqual({
      booking_status: 'cancelled',
      hold_expires_at: null,
      payment_status: 'pending',
      session_status: 'pending',
    });
    await expect(bookings.cancel(booking[0].id)).rejects.toBeInstanceOf(
      ConflictException,
    );

    // The exclusion constraint allows the freed interval to be booked again.
    await dataSource.query(
      `INSERT INTO bookings
       (reference, outlet_id, table_id, customer_name, customer_contact,
        starts_at, ends_at, duration_hours, hourly_rate_idr, total_amount_idr, status)
       VALUES ('MHREBOOKED', $1, $2, 'New Guest', '081200000000',
               $3, $4, 1, 75000, 75000, 'confirmed')`,
      [outlet[0].id, table[0].id, startsAt, endsAt],
    );
    const payments = new PaymentsService(
      dataSource.getRepository(PaymentSessionEntity),
      dataSource,
      {} as DokuClientService,
      {} as OutletAccessService,
      {} as ConfigService,
    );
    await payments.handleNotification(
      'dev',
      {
        order: { invoice_number: 'MHCANCELCHECKOUT', amount: 75000 },
        transaction: { status: 'SUCCESS', date: new Date().toISOString() },
      },
      'cancel-integration-notification',
    );
    const afterNotification = (await dataSource.query(
      `SELECT b.status AS booking_status, p.status AS payment_status,
         s.status AS session_status, s.reservation_needs_review
       FROM bookings b
       JOIN payments p ON p.booking_id = b.id
       JOIN payment_sessions s ON s.id = p.payment_session_id
       WHERE b.id = $1`,
      [booking[0].id],
    )) as {
      booking_status: string;
      payment_status: string;
      session_status: string;
      reservation_needs_review: boolean;
    }[];
    expect(afterNotification[0]).toEqual({
      booking_status: 'cancelled',
      payment_status: 'succeeded',
      session_status: 'succeeded',
      reservation_needs_review: true,
    });
  });

  it('cancels a future confirmed booking but refuses one whose start has passed', async () => {
    const outlet = (await dataSource.query(
      `INSERT INTO outlets (name, city, address)
       VALUES ('Confirmed outlet', 'Jakarta', 'Test street') RETURNING id`,
    )) as { id: string }[];
    const table = (await dataSource.query(
      `INSERT INTO mahjong_tables (outlet_id, name, hourly_rate_idr)
       VALUES ($1, 'Confirmed table', 75000) RETURNING id`,
      [outlet[0].id],
    )) as { id: string }[];
    const startsAt = new Date(Date.now() + 86_400_000);
    const endsAt = new Date(startsAt.getTime() + 3_600_000);
    const booking = (await dataSource.query(
      `INSERT INTO bookings
       (reference, outlet_id, table_id, customer_name, customer_contact,
        starts_at, ends_at, duration_hours, hourly_rate_idr, total_amount_idr, status)
       VALUES ('MHFUTURECONFIRMED', $1, $2, 'Guest', '081234567890',
               $3, $4, 1, 75000, 75000, 'confirmed') RETURNING id`,
      [outlet[0].id, table[0].id, startsAt, endsAt],
    )) as { id: string }[];
    const session = (await dataSource.query(
      `INSERT INTO payment_sessions
       (invoice_number, environment, status, customer_name, customer_phone, customer_email, amount_idr, expires_at, settled_at)
       VALUES ('MHCONFIRMEDCHECKOUT', 'dev', 'succeeded', 'Guest', '081234567890',
               'guest@example.com', 75000, $1, CURRENT_TIMESTAMP) RETURNING id`,
      [new Date(Date.now() + 10 * 60_000)],
    )) as { id: string }[];
    await dataSource.query(
      `INSERT INTO payment_session_bookings (payment_session_id, booking_id)
       VALUES ($1, $2)`,
      [session[0].id, booking[0].id],
    );
    await dataSource.query(
      `INSERT INTO payments
       (booking_id, payment_session_id, kind, status, amount_idr,
        provider, idempotency_key, settled_at)
       VALUES ($1, $2, 'charge', 'succeeded', 75000, 'DOKU_DEV',
               'confirmed-cancel-integration', CURRENT_TIMESTAMP)`,
      [booking[0].id, session[0].id],
    );
    const bookings = new BookingsService(
      dataSource.getRepository(BookingEntity),
      dataSource.getRepository(TableEntity),
      dataSource.getRepository(OutletEntity),
      {} as OutletAccessService,
    );
    await expect(bookings.cancel(booking[0].id)).resolves.toEqual({
      id: booking[0].id,
      status: 'cancelled',
    });
    const payment = (await dataSource.query(
      `SELECT s.status AS session_status, p.status AS payment_status
       FROM payments p JOIN payment_sessions s ON s.id = p.payment_session_id
       WHERE p.booking_id = $1`,
      [booking[0].id],
    )) as { session_status: string; payment_status: string }[];
    expect(payment).toEqual([
      {
        session_status: 'succeeded',
        payment_status: 'succeeded',
      },
    ]);

    const pastStartsAt = new Date(Date.now() - 2 * 3_600_000);
    const pastEndsAt = new Date(pastStartsAt.getTime() + 3_600_000);
    const started = (await dataSource.query(
      `INSERT INTO bookings
       (reference, outlet_id, table_id, customer_name, customer_contact,
        starts_at, ends_at, duration_hours, hourly_rate_idr, total_amount_idr, status)
       VALUES ('MHSTARTEDCONFIRMED', $1, $2, 'Guest', '081234567890',
               $3, $4, 1, 75000, 75000, 'confirmed') RETURNING id`,
      [outlet[0].id, table[0].id, pastStartsAt, pastEndsAt],
    )) as { id: string }[];
    await expect(bookings.cancel(started[0].id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('waits for a table update and prices checkout from the locked row', async () => {
    const outlet = (await dataSource.query(
      `INSERT INTO outlets (name, city, address) VALUES ('Checkout outlet', 'Jakarta', 'Test street') RETURNING id`,
    )) as { id: string }[];
    const table = (await dataSource.query(
      `INSERT INTO mahjong_tables (outlet_id, name, hourly_rate_idr)
       VALUES ($1, 'Checkout table', 75000) RETURNING id`,
      [outlet[0].id],
    )) as { id: string }[];
    const updater = dataSource.createQueryRunner();
    await updater.connect();
    await updater.startTransaction();
    try {
      await updater.query(
        `UPDATE mahjong_tables SET hourly_rate_idr = 90000 WHERE id = $1`,
        [table[0].id],
      );
      const doku = {
        createCheckout: vi.fn().mockResolvedValue({
          checkoutUrl: 'https://checkout.example.com/order',
          dokuSessionId: 'doku-checkout-test',
          expiresAt: new Date(Date.now() + 15 * 60_000),
        }),
      };
      const config = {
        get: vi.fn((_key: string, fallback?: string) => fallback),
      };
      const service = new PaymentsService(
        dataSource.getRepository(PaymentSessionEntity),
        dataSource,
        doku as unknown as DokuClientService,
        {
          allowed: vi.fn().mockResolvedValue(true),
        } as unknown as OutletAccessService,
        config as unknown as ConfigService,
      );
      const startsAt = new Date(Date.now() + 2 * 86_400_000);
      startsAt.setUTCHours(5, 0, 0, 0);
      const checkout = service.createCheckout('dev', {
        outletId: outlet[0].id,
        customerName: 'Guest',
        customerPhone: '081234567890',
        customerEmail: 'guest@example.com',
        sessions: [
          {
            tableId: table[0].id,
            startsAt: startsAt.toISOString(),
            durationHours: 1,
          },
        ],
      });
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        const activity = (await dataSource.query(
          `SELECT EXISTS (
             SELECT 1 FROM pg_stat_activity
             WHERE wait_event_type = 'Lock'
               AND query ILIKE '%mahjong_tables%'
               AND query ILIKE '%FOR UPDATE%'
           ) AS waiting`,
        )) as { waiting: boolean }[];
        waiting = activity[0].waiting;
        if (!waiting) await delay(25);
      }
      await updater.commitTransaction();
      const result = await checkout;
      expect(waiting).toBe(true);
      expect(result.checkoutUrl).toBe('https://checkout.example.com/order');
      expect(doku.createCheckout).toHaveBeenCalledWith(
        'dev',
        expect.objectContaining({ amount: 90_000 }),
      );
    } finally {
      if (updater.isTransactionActive) await updater.rollbackTransaction();
      await updater.release();
    }
  }, 10_000);
});
