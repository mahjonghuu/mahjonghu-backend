import type { Repository } from 'typeorm';
import { OutletEntity } from '../outlets/entities/outlet.entity.js';
import { TableEntity } from '../tables/entities/table.entity.js';
import { BookingEntity } from './entities/booking.entity.js';
import { BookingsService } from './bookings.service.js';

describe('BookingsService', () => {
  it('rejects past availability intervals before querying repositories', async () => {
    const bookings = {
      createQueryBuilder: vi.fn(),
    } as unknown as Repository<BookingEntity>;
    const tables = {
      createQueryBuilder: vi.fn(),
    } as unknown as Repository<TableEntity>;
    const service = new BookingsService(
      bookings,
      tables,
      {} as Repository<OutletEntity>,
    );

    await expect(
      service.findAvailable({
        outletId: 'c45a7ff3-67b7-4b23-9030-0b26095d2cf2',
        startsAt: '2020-01-01T00:00:00.000Z',
        durationHours: 1,
      }),
    ).rejects.toThrow('Booking start time must be in the future.');
    expect(bookings.createQueryBuilder).not.toHaveBeenCalled();
    expect(tables.createQueryBuilder).not.toHaveBeenCalled();
  });
});
