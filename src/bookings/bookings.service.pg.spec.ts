import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { InitialSchema1791590400000 } from '../database/migrations/1791590400000-InitialSchema.js';
import { AddDokuPaymentSessions1791763200000 } from '../database/migrations/1791763200000-AddDokuPaymentSessions.js';
import { MovePricingToOutlets1792108800000 } from '../database/migrations/1792108800000-MovePricingToOutlets.js';
import { AddHappyHourPricing1792195200000 } from '../database/migrations/1792195200000-AddHappyHourPricing.js';
import { OutletEntity } from '../outlets/entities/outlet.entity.js';
import type { OutletAccessService } from '../outlets/outlet-access.service.js';
import { TableEntity } from '../tables/entities/table.entity.js';
import { PaymentEntity } from '../payments/entities/payment.entity.js';
import { PaymentSessionEntity } from '../payments/entities/payment-session.entity.js';
import { BookingEntity } from './entities/booking.entity.js';
import { BookingsService } from './bookings.service.js';

const databaseUrl = process.env.PAYMENTS_TEST_DATABASE_URL;
const schema = `booking_lookup_test_${randomUUID().replaceAll('-', '')}`;

/** Exercises phone matching and the public projection against actual PostgreSQL rows. */
describe.skipIf(!databaseUrl)('BookingsService PostgreSQL phone lookup', () => {
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

  it('returns all sessions for normalized phones, ordered recently first, with expired holds and no identity or payment details', async () => {
    const outlet = (await dataSource.query(
      `INSERT INTO outlets (name, city, address)
       VALUES ('Jakarta outlet', 'Jakarta', 'Test street') RETURNING id`,
    )) as { id: string }[];
    const table = (await dataSource.query(
      `INSERT INTO mahjong_tables (outlet_id, name)
       VALUES ($1, 'Blue table') RETURNING id`,
      [outlet[0].id],
    )) as { id: string }[];
    const futureHold = new Date(Date.now() + 60_000);
    const pastHold = new Date(Date.now() - 60_000);
    const cases = [
      {
        phone: '0895 1234-5678',
        startsAt: '2030-01-01T05:00:00.000Z',
        status: 'confirmed',
        hold: futureHold,
      },
      {
        phone: '+62 895-1234 5678',
        startsAt: '2030-01-03T05:00:00.000Z',
        status: 'pending',
        hold: pastHold,
      },
      {
        phone: '62 895-1234 5678',
        startsAt: '2030-01-02T05:00:00.000Z',
        status: 'cancelled',
        hold: futureHold,
      },
      {
        phone: '089512345678',
        startsAt: '2030-01-05T05:00:00.000Z',
        status: 'pending',
        hold: futureHold,
      },
      {
        phone: '081234567890',
        startsAt: '2030-01-04T05:00:00.000Z',
        status: 'confirmed',
        hold: futureHold,
      },
    ];
    for (const [index, row] of cases.entries()) {
      const session = (await dataSource.query(
        `INSERT INTO payment_sessions
         (invoice_number, environment, status, customer_name, customer_phone,
          customer_email, amount_idr, expires_at)
         VALUES ($1, 'dev', $4, 'Private name', $2, 'private@example.com', 75000, $3)
         RETURNING id`,
        [
          `MHLOOKUP${index}`,
          row.phone,
          row.hold,
          row.status === 'pending' ? 'pending' : 'succeeded',
        ],
      )) as { id: string }[];
      const booking = (await dataSource.query(
        `INSERT INTO bookings
         (reference, outlet_id, table_id, customer_name, customer_contact,
          starts_at, ends_at, duration_hours, hourly_rate_idr, total_amount_idr,
          status, hold_expires_at, created_at)
         VALUES ($1, $2, $3, 'Private name', $4, $5, $5::timestamptz + interval '1 hour',
                 1, 75000, 75000, $6, $7, $8)
         RETURNING id`,
        [
          `PRIVATEBOOKING${index}`,
          outlet[0].id,
          table[0].id,
          row.phone,
          row.startsAt,
          row.status,
          row.hold,
          new Date(pastHold.getTime() - 60_000),
        ],
      )) as { id: string }[];
      await dataSource.query(
        `INSERT INTO payment_session_bookings (payment_session_id, booking_id)
         VALUES ($1, $2)`,
        [session[0].id, booking[0].id],
      );
    }

    const service = new BookingsService(
      dataSource.getRepository(BookingEntity),
      dataSource.getRepository(TableEntity),
      dataSource.getRepository(OutletEntity),
      {} as OutletAccessService,
    );
    const bookings = [
      {
        outletName: 'Jakarta outlet',
        tableName: 'Blue table',
        startsAt: new Date('2030-01-05T05:00:00.000Z'),
        durationHours: 1,
        status: 'pending',
      },
      {
        outletName: 'Jakarta outlet',
        tableName: 'Blue table',
        startsAt: new Date('2030-01-03T05:00:00.000Z'),
        durationHours: 1,
        status: 'expired',
      },
      {
        outletName: 'Jakarta outlet',
        tableName: 'Blue table',
        startsAt: new Date('2030-01-02T05:00:00.000Z'),
        durationHours: 1,
        status: 'cancelled',
      },
      {
        outletName: 'Jakarta outlet',
        tableName: 'Blue table',
        startsAt: new Date('2030-01-01T05:00:00.000Z'),
        durationHours: 1,
        status: 'confirmed',
      },
    ];
    for (const phone of [
      '089512345678',
      '62 895-1234 5678',
      '+62 895 1234-5678',
    ]) {
      expect(await service.lookupByPhone(phone)).toEqual({ bookings });
    }
    expect(await service.lookupByPhone('081111111111')).toEqual({ bookings: [] });
  });
});
