import type { DataSource, Repository } from 'typeorm';
import { OutletEntity } from '../outlets/entities/outlet.entity.js';
import { TableEntity } from '../tables/entities/table.entity.js';
import { BookingEntity } from './entities/booking.entity.js';
import { BookingsService } from './bookings.service.js';

const dto = {
  outletId: 'c45a7ff3-67b7-4b23-9030-0b26095d2cf2',
  tableId: '15818cd8-b3c0-45b0-aea3-d8dc15df93b2',
  customerName: '  Ada Guest  ',
  customerContact: '  +628123456789  ',
  startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  durationHours: 2,
};

describe('BookingsService', () => {
  it('creates a pending hold with normalized guest details and snapshotted price', async () => {
    const table = {
      id: dto.tableId,
      outletId: dto.outletId,
      hourlyRateIdr: '75000',
    } as TableEntity;
    const bookingQuery = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };
    const bookingsRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(bookingQuery),
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => ({ ...value, reference: 'MHREFERENCE' })),
    };
    const manager = {
      getRepository: vi.fn((entity) =>
        entity === TableEntity
          ? { findOne: vi.fn().mockResolvedValue(table) }
          : entity === OutletEntity
            ? { findOne: vi.fn().mockResolvedValue({ id: dto.outletId }) }
            : bookingsRepository,
      ),
      query: vi.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      transaction: vi.fn((work) => work(manager)),
    } as unknown as DataSource;
    const service = new BookingsService(
      {} as Repository<BookingEntity>,
      {} as Repository<TableEntity>,
      {} as Repository<OutletEntity>,
      dataSource,
    );
    const response = await service.create(dto);
    expect(response).toMatchObject({
      reference: 'MHREFERENCE',
      outletId: dto.outletId,
      tableId: dto.tableId,
      durationHours: 2,
      hourlyRateIdr: '75000',
      totalAmountIdr: '150000',
      status: 'pending',
    });
    expect(bookingsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: 'Ada Guest',
        customerContact: '+628123456789',
        userId: null,
        hourlyRateIdr: '75000',
        totalAmountIdr: '150000',
        status: 'pending',
        holdExpiresAt: expect.any(Date),
      }),
    );
    expect(response).not.toHaveProperty('customerContact');
  });

  it('rejects past booking intervals before opening a database transaction', async () => {
    const dataSource = { transaction: vi.fn() } as unknown as DataSource;
    const service = new BookingsService(
      {} as Repository<BookingEntity>,
      {} as Repository<TableEntity>,
      {} as Repository<OutletEntity>,
      dataSource,
    );

    await expect(
      service.create({ ...dto, startsAt: '2020-01-01T00:00:00.000Z' }),
    ).rejects.toThrow('Booking start time must be in the future.');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
