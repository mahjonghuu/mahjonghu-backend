import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { BookingEntity } from '../bookings/entities/booking.entity.js';
import { BookingsService } from '../bookings/bookings.service.js';
import { InitialSchema1791590400000 } from '../database/migrations/1791590400000-InitialSchema.js';
import { AddDokuPaymentSessions1791763200000 } from '../database/migrations/1791763200000-AddDokuPaymentSessions.js';
import { AddOutletOperatingHours1791849600000 } from '../database/migrations/1791849600000-AddOutletOperatingHours.js';
import { AddPrivateOutletAccess1791936000000 } from '../database/migrations/1791936000000-AddPrivateOutletAccess.js';
import { AllowOvernightOutletHours1792022400000 } from '../database/migrations/1792022400000-AllowOvernightOutletHours.js';
import { MovePricingToOutlets1792108800000 } from '../database/migrations/1792108800000-MovePricingToOutlets.js';
import { AddHappyHourPricing1792195200000 } from '../database/migrations/1792195200000-AddHappyHourPricing.js';
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
        AddOutletOperatingHours1791849600000,
        AddPrivateOutletAccess1791936000000,
        AllowOvernightOutletHours1792022400000,
        MovePricingToOutlets1792108800000,
        AddHappyHourPricing1792195200000,
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
        `INSERT INTO mahjong_tables (outlet_id, name)
         VALUES ($1, $2) RETURNING id`,
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
      `INSERT INTO mahjong_tables (outlet_id, name)
       VALUES ($1, 'Cancellation table') RETURNING id`,
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
      `INSERT INTO mahjong_tables (outlet_id, name)
       VALUES ($1, 'Confirmed table') RETURNING id`,
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

  it('persists mixed happy-hour totals in booking, payment and DOKU snapshots', async () => {
    const happyHour = { days: [1], startHour: 16, endHour: 18, rate: 60000 };
    const outlet = (await dataSource.query(
      `INSERT INTO outlets (name, city, address, hourly_rate_idr, pricing_mode, happy_hour)
       VALUES ('Happy hour outlet', 'Jakarta', 'Street', 100000, 'happy_hour', $1::jsonb)
       RETURNING id`, [JSON.stringify(happyHour)],
    )) as { id: string }[];
    const table = (await dataSource.query(
      `INSERT INTO mahjong_tables (outlet_id, name) VALUES ($1, 'Happy table') RETURNING id`,
      [outlet[0].id],
    )) as { id: string }[];
    const doku = {
      createCheckout: vi.fn().mockResolvedValue({
        checkoutUrl: 'https://checkout.example.com/happy',
        dokuSessionId: 'doku-happy',
        expiresAt: new Date(Date.now() + 15 * 60_000),
      }),
    };
    const service = new PaymentsService(
      dataSource.getRepository(PaymentSessionEntity), dataSource,
      doku as unknown as DokuClientService,
      { allowed: vi.fn().mockResolvedValue(true) } as unknown as OutletAccessService,
      { get: vi.fn((_key: string, fallback?: string) => fallback) } as unknown as ConfigService,
    );
    const checkout = await service.createCheckout('dev', {
      outletId: outlet[0].id,
      customerName: 'Guest', customerPhone: '081234567890',
      customerEmail: 'happy@example.com',
      sessions: [{ tableId: table[0].id, startsAt: '2030-01-07T08:00:00Z', durationHours: 4 }],
    });
    expect(doku.createCheckout).toHaveBeenCalledWith(
      'dev', expect.objectContaining({ amount: 320000 }),
    );
    const snapshot = (await dataSource.query(
      `SELECT b.hourly_rate_idr AS "hourlyRateIdr", b.total_amount_idr AS "totalAmountIdr",
              p.amount_idr AS "paymentAmountIdr", s.amount_idr AS "sessionAmountIdr"
       FROM payment_sessions s JOIN payment_session_bookings psb ON psb.payment_session_id = s.id
       JOIN bookings b ON b.id = psb.booking_id
       JOIN payments p ON p.booking_id = b.id
       WHERE s.invoice_number = $1`, [checkout.reference],
    )) as { hourlyRateIdr: string; totalAmountIdr: string; paymentAmountIdr: string; sessionAmountIdr: string }[];
    expect(snapshot).toEqual([{
      hourlyRateIdr: '100000', totalAmountIdr: '320000',
      paymentAmountIdr: '320000', sessionAmountIdr: '320000',
    }]);
    await dataSource.query(
      `UPDATE outlets SET pricing_mode = 'duration', happy_hour = NULL, hourly_rate_idr = 200000
       WHERE id = $1`, [outlet[0].id],
    );
    const persisted = (await dataSource.query(
      `SELECT total_amount_idr AS "totalAmountIdr" FROM bookings WHERE outlet_id = $1`,
      [outlet[0].id],
    )) as { totalAmountIdr: string }[];
    expect(persisted).toEqual([{ totalAmountIdr: '320000' }]);
  });

  it('enforces exclusive pricing schedules and valid happy-hour windows in PostgreSQL', async () => {
    const outlet = (await dataSource.query(
      `INSERT INTO outlets (name, city, address) VALUES ('Pricing constraints', 'Jakarta', 'Street')
       RETURNING id, pricing_mode AS "pricingMode", happy_hour AS "happyHour"`,
    )) as { id: string; pricingMode: string; happyHour: unknown }[];
    expect(outlet[0]).toMatchObject({ pricingMode: 'duration', happyHour: null });
    const valid = { days: [1, 6], startHour: 16, endHour: 19, rate: 60000 };
    for (const configuration of [
      { ...valid, days: [1, 1] }, { ...valid, days: [0] },
      { ...valid, endHour: 16 }, { ...valid, rate: 0 },
      { ...valid, rate: 1_000_000_001 },
    ]) {
      await expect(dataSource.query(
        `UPDATE outlets SET pricing_mode = 'happy_hour', happy_hour = $2::jsonb WHERE id = $1`,
        [outlet[0].id, JSON.stringify(configuration)],
      )).rejects.toThrow();
    }
    await expect(dataSource.query(
      `UPDATE outlets SET pricing_mode = 'happy_hour' WHERE id = $1`, [outlet[0].id],
    )).rejects.toThrow();
    await dataSource.query(
      `UPDATE outlets SET pricing_mode = 'happy_hour', happy_hour = $2::jsonb WHERE id = $1`,
      [outlet[0].id, JSON.stringify(valid)],
    );
    await expect(dataSource.query(
      `UPDATE outlets SET rate_tiers = '[{"durationHours":2,"rate":80000}]'::jsonb
       WHERE id = $1`, [outlet[0].id],
    )).rejects.toThrow();
    await expect(dataSource.query(
      `UPDATE outlets SET pricing_mode = 'duration' WHERE id = $1`, [outlet[0].id],
    )).rejects.toThrow();
  });

  it('snapshots the latest effective hourly tier per booking and charges DOKU the sum', async () => {
    const outlet = (await dataSource.query(
      `INSERT INTO outlets (name, city, address, hourly_rate_idr)
       VALUES ('Tier outlet', 'Jakarta', 'Test street', 100000) RETURNING id`,
    )) as { id: string }[];
    const table = (await dataSource.query(
      `INSERT INTO mahjong_tables (outlet_id, name)
       VALUES ($1, 'Tier table') RETURNING id`,
      [outlet[0].id],
    )) as { id: string }[];
    const secondTable = (await dataSource.query(
      `INSERT INTO mahjong_tables (outlet_id, name)
       VALUES ($1, 'Other tier table') RETURNING id`,
      [outlet[0].id],
    )) as { id: string }[];
    const independentOutlet = (await dataSource.query(
      `INSERT INTO outlets (name, city, address, hourly_rate_idr)
       VALUES ('Independent outlet', 'Jakarta', 'Other street', 95000) RETURNING id`,
    )) as { id: string }[];
    await dataSource.query(
      `UPDATE outlets SET rate_tiers = $2::jsonb WHERE id = $1`,
      [
        outlet[0].id,
        JSON.stringify([
          { durationHours: 2, rate: 80000 },
          { durationHours: 5, rate: 70000 },
        ]),
      ],
    );
    const doku = {
      createCheckout: vi.fn().mockResolvedValue({
        checkoutUrl: 'https://checkout.example.com/tier-order',
        dokuSessionId: 'doku-tier-test',
        expiresAt: new Date(Date.now() + 15 * 60_000),
      }),
    };
    const service = new PaymentsService(
      dataSource.getRepository(PaymentSessionEntity),
      dataSource,
      doku as unknown as DokuClientService,
      {
        allowed: vi.fn().mockResolvedValue(true),
      } as unknown as OutletAccessService,
      {
        get: vi.fn((_key: string, fallback?: string) => fallback),
      } as unknown as ConfigService,
    );
    const start = new Date(Date.now() + 2 * 86_400_000);
    start.setUTCHours(5, 0, 0, 0);
    const checkout = await service.createCheckout('dev', {
      outletId: outlet[0].id,
      customerName: 'Guest',
      customerPhone: '081234567890',
      customerEmail: 'guest@example.com',
      sessions: [1, 2, 3, 4, 5].map((durationHours, index) => ({
        tableId: index < 3 ? table[0].id : secondTable[0].id,
        startsAt: new Date(start.getTime() + index * 86_400_000).toISOString(),
        durationHours,
      })),
    });
    expect(doku.createCheckout).toHaveBeenCalledWith(
      'dev',
      expect.objectContaining({ amount: 1_170_000 }),
    );
    const amounts = (await dataSource.query(
      `SELECT b.duration_hours AS "durationHours",
         b.hourly_rate_idr AS "hourlyRateIdr", b.total_amount_idr AS "totalAmountIdr",
         p.amount_idr AS "paymentAmountIdr"
       FROM bookings b JOIN payments p ON p.booking_id = b.id
       JOIN payment_sessions s ON s.id = p.payment_session_id
       WHERE s.invoice_number = $1 ORDER BY b.duration_hours`,
      [checkout.reference],
    )) as {
      durationHours: number;
      hourlyRateIdr: string;
      totalAmountIdr: string;
      paymentAmountIdr: string;
    }[];
    expect(amounts).toEqual([
      {
        durationHours: 1,
        hourlyRateIdr: '100000',
        totalAmountIdr: '100000',
        paymentAmountIdr: '100000',
      },
      {
        durationHours: 2,
        hourlyRateIdr: '80000',
        totalAmountIdr: '160000',
        paymentAmountIdr: '160000',
      },
      {
        durationHours: 3,
        hourlyRateIdr: '80000',
        totalAmountIdr: '240000',
        paymentAmountIdr: '240000',
      },
      {
        durationHours: 4,
        hourlyRateIdr: '80000',
        totalAmountIdr: '320000',
        paymentAmountIdr: '320000',
      },
      {
        durationHours: 5,
        hourlyRateIdr: '70000',
        totalAmountIdr: '350000',
        paymentAmountIdr: '350000',
      },
    ]);
    await dataSource.query(
      `UPDATE outlets SET hourly_rate_idr = 150000, rate_tiers = '[]'::jsonb WHERE id = $1`,
      [outlet[0].id],
    );
    const snapshots = (await dataSource.query(
      `SELECT hourly_rate_idr AS "hourlyRateIdr", total_amount_idr AS "totalAmountIdr"
       FROM bookings WHERE outlet_id = $1 AND table_id IN ($2, $3) ORDER BY duration_hours`,
      [outlet[0].id, table[0].id, secondTable[0].id],
    )) as { hourlyRateIdr: string; totalAmountIdr: string }[];
    expect(snapshots).toEqual(
      amounts.map(({ hourlyRateIdr, totalAmountIdr }) => ({
        hourlyRateIdr,
        totalAmountIdr,
      })),
    );
    const independentRate = (await dataSource.query(
      `SELECT hourly_rate_idr FROM outlets WHERE id = $1`,
      [independentOutlet[0].id],
    )) as { hourly_rate_idr: string }[];
    expect(independentRate[0].hourly_rate_idr).toBe('95000');
    const repriced = await service.createCheckout('dev', {
      outletId: outlet[0].id,
      customerName: 'Guest',
      customerPhone: '081234567890',
      customerEmail: 'guest@example.com',
      sessions: [
        {
          tableId: table[0].id,
          startsAt: new Date(start.getTime() + 10 * 86_400_000).toISOString(),
          durationHours: 1,
        },
        {
          tableId: secondTable[0].id,
          startsAt: new Date(start.getTime() + 10 * 86_400_000).toISOString(),
          durationHours: 2,
        },
      ],
    });
    const repricedRates = (await dataSource.query(
      `SELECT b.hourly_rate_idr AS "rate" FROM bookings b
       JOIN payment_session_bookings sb ON sb.booking_id = b.id
       JOIN payment_sessions s ON s.id = sb.payment_session_id
       WHERE s.invoice_number = $1 ORDER BY b.duration_hours`,
      [repriced.reference],
    )) as { rate: string }[];
    expect(repricedRates).toEqual([{ rate: '150000' }, { rate: '150000' }]);
    expect(doku.createCheckout).toHaveBeenLastCalledWith(
      'dev',
      expect.objectContaining({ amount: 450_000 }),
    );
  });

  it('waits for a tier update and prices checkout from the locked row', async () => {
    const outlet = (await dataSource.query(
      `INSERT INTO outlets (name, city, address) VALUES ('Checkout outlet', 'Jakarta', 'Test street') RETURNING id`,
    )) as { id: string }[];
    const table = (await dataSource.query(
      `INSERT INTO mahjong_tables (outlet_id, name)
       VALUES ($1, 'Checkout table') RETURNING id`,
      [outlet[0].id],
    )) as { id: string }[];
    const updater = dataSource.createQueryRunner();
    await updater.connect();
    await updater.startTransaction();
    try {
      await updater.query(
        `UPDATE outlets SET hourly_rate_idr = 90000,
         rate_tiers = '[{"durationHours":2,"rate":80000}]'::jsonb WHERE id = $1`,
        [outlet[0].id],
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
            durationHours: 2,
          },
        ],
      });
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        const activity = (await dataSource.query(
          `SELECT EXISTS (
             SELECT 1 FROM pg_stat_activity
             WHERE wait_event_type = 'Lock'
               AND query ILIKE '%outlets%'
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
        expect.objectContaining({ amount: 160_000 }),
      );
    } finally {
      if (updater.isTransactionActive) await updater.rollbackTransaction();
      await updater.release();
    }
  }, 10_000);
});
