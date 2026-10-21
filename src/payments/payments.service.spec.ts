import type { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';
import { OutletEntity } from '../outlets/entities/outlet.entity.js';
import type { OutletAccessService } from '../outlets/outlet-access.service.js';
import { TableEntity } from '../tables/entities/table.entity.js';
import type { CreateDokuCheckoutDto } from './dto/create-doku-checkout.dto.js';
import { DokuClientService } from './doku-client.service.js';
import { PaymentSessionEntity } from './entities/payment-session.entity.js';
import { PaymentsService } from './payments.service.js';

const now = new Date('2026-10-12T08:00:00.000Z');
const startsAt = '2026-10-13T05:00:00.000Z';
const outletId = 'c45a7ff3-67b7-4b23-9030-0b26095d2cf2';
const tableId = '15818cd8-b3c0-45b0-aea3-d8dc15df93b2';

function createService(
  sessions: Partial<Repository<PaymentSessionEntity>>,
  dataSource: Partial<DataSource>,
  doku: Partial<DokuClientService> = {},
  config: Partial<ConfigService> = {},
) {
  return new PaymentsService(
    sessions as Repository<PaymentSessionEntity>,
    dataSource as DataSource,
    doku as DokuClientService,
    {
      allowed: vi.fn().mockResolvedValue(true),
    } as unknown as OutletAccessService,
    config as ConfigService,
  );
}

describe('PaymentsService', () => {
  afterEach(() => vi.useRealTimers());

  it('creates price-authoritative booking holds for exactly the DOKU expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const sessionRecord: Record<string, unknown> = {};
    const bookingRows: Record<string, unknown>[] = [];
    const paymentRows: Record<string, unknown>[] = [];
    const sessionRepository = {
      create: vi.fn((row) => ({ ...row })),
      save: vi.fn(async (row) =>
        Object.assign(sessionRecord, row, { id: 'session-1' }),
      ),
      update: vi.fn(async (_id, row) => Object.assign(sessionRecord, row)),
    };
    const tableQuery = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      setLock: vi.fn().mockReturnThis(),
      getMany: vi
        .fn()
        .mockResolvedValue([{ id: tableId, outletId, hourlyRateIdr: '75000' }]),
    };
    const tablesRepository = { createQueryBuilder: vi.fn(() => tableQuery) };
    const manager = {
      getRepository: vi.fn((entity) => {
        if (entity === PaymentSessionEntity) return sessionRepository;
        if (entity === TableEntity) return tablesRepository;
        if (entity === OutletEntity)
          return {
            findOne: vi
              .fn()
              .mockResolvedValue({ id: outletId, timezone: 'Asia/Jakarta' }),
          };
        throw new Error('Unexpected repository');
      }),
      query: vi.fn(async (sql: string, parameters: unknown[] = []) => {
        if (sql.includes('INSERT INTO bookings')) {
          for (let index = 0; index < parameters.length / 13; index += 1) {
            bookingRows.push({
              reference: parameters[index * 13],
              totalAmountIdr: parameters[index * 13 + 10],
              holdExpiresAt: parameters[index * 13 + 12],
            });
          }
          return Array.from({ length: parameters.length / 13 }, (_, index) => ({
            id: `booking-${index + 1}`,
            reference: parameters[index * 13],
          }));
        }
        if (sql.includes('INSERT INTO payments')) {
          for (let index = 0; index < parameters.length / 10; index += 1) {
            paymentRows.push({
              bookingId: parameters[index * 10],
              paymentSessionId: parameters[index * 10 + 1],
              amountIdr: parameters[index * 10 + 4],
            });
          }
        }
        return [];
      }),
    };
    const dataSource = {
      transaction: vi.fn((callback) => callback(manager)),
    };
    const providerExpiry = new Date(now.getTime() + 15 * 60_000);
    const doku = {
      createCheckout: vi.fn().mockResolvedValue({
        checkoutUrl: 'https://sandbox.doku.com/checkout-link/token',
        dokuSessionId: 'doku-token',
        expiresAt: providerExpiry,
      }),
    };
    const config = {
      get: vi.fn((key: string, fallback?: string) =>
        key === 'WEB_PUBLIC_URL'
          ? 'https://booking.example.com'
          : key === 'BACKEND_PUBLIC_URL'
            ? 'https://api.example.com'
            : fallback,
      ),
    };
    const sessions = {};
    const service = createService(sessions, dataSource, doku, config);
    const dto: CreateDokuCheckoutDto = {
      outletId,
      customerName: ' Ada Guest ',
      customerPhone: '081234567890',
      customerEmail: 'ADA@example.com',
      sessions: [
        { tableId, startsAt, durationHours: 1 },
        { tableId, startsAt: '2026-10-13T06:00:00.000Z', durationHours: 1 },
      ],
    };

    const checkout = await service.createCheckout('dev', dto);

    expect(checkout.checkoutUrl).toBe(
      'https://sandbox.doku.com/checkout-link/token',
    );
    expect(doku.createCheckout).toHaveBeenCalledWith(
      'dev',
      expect.objectContaining({ amount: 150_000 }),
    );
    expect(bookingRows).toHaveLength(2);
    expect(bookingRows.map((row) => row.totalAmountIdr)).toEqual([
      '75000',
      '75000',
    ]);
    expect(
      bookingRows.every(
        (row) => row.holdExpiresAt.getTime() === providerExpiry.getTime(),
      ),
    ).toBe(true);
    expect(paymentRows).toHaveLength(2);
    expect(
      paymentRows.every((row) => row.paymentSessionId === 'session-1'),
    ).toBe(true);
    expect(
      manager.query.mock.calls.filter(([sql]) => sql.includes('JOIN (VALUES')),
    ).toHaveLength(1);
    expect(
      manager.query.mock.calls.filter(([sql]) =>
        sql.includes('INSERT INTO bookings'),
      ),
    ).toHaveLength(1);
    expect(
      manager.query.mock.calls.filter(([sql]) =>
        sql.includes('INSERT INTO payment_session_bookings'),
      ),
    ).toHaveLength(1);
    expect(
      manager.query.mock.calls.filter(([sql]) =>
        sql.includes('INSERT INTO payments'),
      ),
    ).toHaveLength(1);
    expect(tablesRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(tableQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(tableQuery.orderBy).toHaveBeenCalledWith('table.id', 'ASC');
  });

  it('checks overnight checkout bounds in the outlet timezone before holding tables', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const reachedTableLookup = new Error('Reached table lookup');
    const getMany = vi.fn().mockRejectedValue(reachedTableLookup);
    const tableQuery = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      setLock: vi.fn().mockReturnThis(),
      getMany,
    };
    const outlet = {
      id: outletId,
      timezone: 'Asia/Jakarta',
      openingHour: 13,
      closingHour: 4,
    };
    const manager = {
      getRepository: vi.fn((entity) => {
        if (entity === OutletEntity)
          return {
            findOne: vi.fn().mockResolvedValue(outlet),
          };
        if (entity === TableEntity)
          return { createQueryBuilder: vi.fn(() => tableQuery) };
        return {};
      }),
    };
    const service = createService(
      {},
      {
        transaction: vi.fn((callback) => callback(manager)),
      } as Partial<DataSource>,
    );
    const checkout = (start: string, durationHours: number) =>
      service.createCheckout('dev', {
        outletId,
        customerName: 'Guest',
        customerPhone: '081234567890',
        customerEmail: 'guest@example.com',
        sessions: [{ tableId, startsAt: start, durationHours }],
      });

    // 02:00–04:00 and 22:00–02:00 local, both on the same operating day.
    await expect(checkout('2026-10-13T19:00:00.000Z', 2)).rejects.toBe(
      reachedTableLookup,
    );
    await expect(checkout('2026-10-13T15:00:00.000Z', 4)).rejects.toBe(
      reachedTableLookup,
    );
    expect(getMany).toHaveBeenCalledTimes(2);

    // 04:00–05:00, 12:00–13:00, and overrunning the next-day close.
    await expect(checkout('2026-10-13T21:00:00.000Z', 1)).rejects.toMatchObject({
      status: 400,
    });
    await expect(checkout('2026-10-13T05:00:00.000Z', 1)).rejects.toMatchObject({
      status: 400,
    });
    await expect(checkout('2026-10-13T20:00:00.000Z', 2)).rejects.toMatchObject({
      status: 400,
    });
    expect(getMany).toHaveBeenCalledTimes(2);

    outlet.closingHour = 0;
    await expect(checkout('2026-10-13T16:00:00.000Z', 1)).rejects.toBe(
      reachedTableLookup,
    );
    await expect(checkout('2026-10-13T17:00:00.000Z', 1)).rejects.toMatchObject({
      status: 400,
    });
    outlet.closingHour = 24;
    await expect(checkout('2026-10-13T16:00:00.000Z', 1)).rejects.toBe(
      reachedTableLookup,
    );
    expect(getMany).toHaveBeenCalledTimes(4);
  });

  it('rejects a private checkout before creating a booking hold', async () => {
    const query = vi.fn();
    const manager = {
      getRepository: vi.fn((entity) =>
        entity === OutletEntity
          ? { findOne: vi.fn().mockResolvedValue({ id: outletId }) }
          : {},
      ),
      query,
    };
    const dataSource = {
      transaction: vi.fn((callback) => callback(manager)),
    };
    const service = new PaymentsService(
      {} as Repository<PaymentSessionEntity>,
      dataSource as unknown as DataSource,
      {} as DokuClientService,
      {
        allowed: vi.fn().mockResolvedValue(false),
      } as unknown as OutletAccessService,
      {} as ConfigService,
    );
    await expect(
      service.createCheckout('dev', {
        outletId,
        customerName: 'Guest',
        customerPhone: '081234567890',
        customerEmail: 'guest@example.com',
        sessions: [{ tableId, startsAt, durationHours: 1 }],
      }),
    ).rejects.toThrow('Outlet tidak ditemukan.');
    expect(query).not.toHaveBeenCalled();
  });

  it('confirms linked bookings only for a signed success transition', async () => {
    const session = {
      id: 'session-1',
      invoiceNumber: 'MHORDER123',
      environment: 'dev',
      status: 'pending',
      amountIdr: '150000',
      expiresAt: new Date('2026-10-12T08:15:00.000Z'),
    } as PaymentSessionEntity;
    const sessionRepository = {
      findOne: vi.fn().mockResolvedValue(session),
      update: vi.fn(),
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'booking-1',
          status: 'pending',
          holdExpiresAt: new Date(Date.now() + 60_000),
        },
      ])
      .mockResolvedValueOnce([{ conflict: false }])
      .mockResolvedValue([]);
    const manager = {
      getRepository: vi.fn(() => sessionRepository),
      query,
    };
    const dataSource = {
      transaction: vi.fn((callback) => callback(manager)),
    };
    const service = createService(sessionRepository, dataSource);

    await expect(
      service.handleNotification(
        'dev',
        {
          order: { invoice_number: 'MHORDER123', amount: 150000 },
          transaction: { status: 'SUCCESS', date: '2026-10-12T08:01:00Z' },
        },
        'doku-event-1',
      ),
    ).resolves.toEqual({ message: 'SUCCESS' });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'confirmed'"),
      ['session-1'],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'succeeded'"),
      ['session-1', new Date('2026-10-12T08:01:00Z')],
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        status: 'succeeded',
        notificationRequestId: 'doku-event-1',
        reservationNeedsReview: false,
      }),
    );
  });

  it('recovers a verified on-time success after an uncertain checkout response', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const session = {
      id: 'session-1',
      invoiceNumber: 'MHORDER123',
      environment: 'dev',
      status: 'failed',
      amountIdr: '75000',
      expiresAt: new Date(now.getTime() + 15 * 60_000),
    } as PaymentSessionEntity;
    const sessionRepository = {
      findOne: vi.fn().mockResolvedValue(session),
      update: vi.fn(),
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'booking-1', status: 'expired' }])
      .mockResolvedValueOnce([{ conflict: false }])
      .mockResolvedValue([]);
    const manager = { getRepository: vi.fn(() => sessionRepository), query };
    const dataSource = { transaction: vi.fn((callback) => callback(manager)) };
    const service = createService(sessionRepository, dataSource);

    await service.handleNotification(
      'dev',
      {
        order: { invoice_number: 'MHORDER123', amount: 75000 },
        transaction: {
          status: 'SUCCESS',
          date: new Date(now.getTime() + 5 * 60_000).toISOString(),
        },
      },
      'doku-recovered-event',
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'confirmed'"),
      ['session-1'],
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        status: 'succeeded',
        reservationNeedsReview: false,
      }),
    );
  });

  it('acknowledges a DOKU failed-method attempt without failing a retryable Checkout', async () => {
    const sessions = { findOne: vi.fn() };
    const dataSource = { transaction: vi.fn() };
    const service = createService(sessions, dataSource);

    await expect(
      service.handleNotification(
        'dev',
        {
          order: { invoice_number: 'MHORDER123', amount: 150000 },
          transaction: { status: 'FAILED' },
        },
        'doku-event-failed',
      ),
    ).resolves.toEqual({ message: 'SUCCESS' });

    expect(sessions.findOne).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('releases booking holds exactly at the 15-minute expiry boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const session = {
      id: 'session-1',
      invoiceNumber: 'MHORDER123',
      status: 'pending',
      environment: 'dev',
      customerName: 'Ada Guest',
      amountIdr: '75000',
      expiresAt: now,
      settledAt: null,
      reservationNeedsReview: false,
    } as PaymentSessionEntity;
    const sessionRepository = {
      findOne: vi.fn().mockResolvedValue(session),
      findOneByOrFail: vi.fn(async () => session),
      update: vi.fn(async (_id, update) => Object.assign(session, update)),
    };
    const query = vi.fn().mockResolvedValue([]);
    const manager = {
      getRepository: vi.fn(() => sessionRepository),
      query,
    };
    const dataSource = {
      transaction: vi.fn((callback) => callback(manager)),
      query: vi.fn().mockResolvedValue([]),
    };
    const service = createService(sessionRepository, dataSource);

    const result = await service.getPublicStatus('MHORDER123');

    expect(result.status).toBe('expired');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'expired'"),
      ['session-1'],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'failed'"),
      ['session-1'],
    );
  });
});
