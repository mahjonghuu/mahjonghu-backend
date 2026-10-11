import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { OutletEntity } from '../outlets/entities/outlet.entity.js';
import { TableEntity } from '../tables/entities/table.entity.js';
import { BookingAvailabilityDto } from './dto/booking-availability.dto.js';
import { CreateBookingDto } from './dto/create-booking.dto.js';
import { BookingEntity } from './entities/booking.entity.js';

const HOLD_MINUTES = 15;

/** Public booking creation and availability, backed by database-enforced exclusivity. */
@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(BookingEntity)
    private readonly bookings: Repository<BookingEntity>,
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
    @InjectRepository(OutletEntity)
    private readonly outlets: Repository<OutletEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /** Lists bookable tables whose active reservation intervals do not overlap. */
  async findAvailable(dto: BookingAvailabilityDto) {
    const startsAt = new Date(dto.startsAt);
    this.validateInterval(startsAt, dto.durationHours);
    const endsAt = new Date(startsAt.getTime() + dto.durationHours * 3_600_000);

    const conflicts = this.bookings
      .createQueryBuilder('booking')
      .select('booking.tableId')
      .where('booking.tableId = table.id')
      .andWhere("booking.status IN ('pending', 'confirmed', 'in_progress')")
      .andWhere('booking.startsAt < :endsAt AND booking.endsAt > :startsAt', {
        startsAt,
        endsAt,
      })
      .andWhere(
        "(booking.status <> 'pending' OR booking.holdExpiresAt > CURRENT_TIMESTAMP)",
      );

    return this.tables
      .createQueryBuilder('table')
      .innerJoin(
        OutletEntity,
        'outlet',
        'outlet.id = table.outletId AND outlet.isActive = true AND outlet.archivedAt IS NULL',
      )
      .select('table.id', 'tableId')
      .addSelect('table.name', 'tableName')
      .addSelect('table.hourlyRateIdr', 'hourlyRateIdr')
      .where('table.outletId = :outletId', { outletId: dto.outletId })
      .andWhere('table.archivedAt IS NULL')
      .andWhere("table.condition = 'available'")
      .andWhere(`NOT EXISTS (${conflicts.getQuery()})`)
      .setParameters(conflicts.getParameters())
      .orderBy('table.name', 'ASC')
      .getRawMany<{
        tableId: string;
        tableName: string;
        hourlyRateIdr: string;
      }>();
  }

  /** Lists booking details for the internal dashboard, including customer contact. */
  async findAllForDashboard() {
    return this.bookings
      .createQueryBuilder('booking')
      .innerJoin(OutletEntity, 'outlet', 'outlet.id = booking.outletId')
      .innerJoin(TableEntity, 'table', 'table.id = booking.tableId')
      .select('booking.id', 'id')
      .addSelect('booking.reference', 'reference')
      .addSelect('booking.outletId', 'outletId')
      .addSelect('outlet.name', 'outletName')
      .addSelect('booking.tableId', 'tableId')
      .addSelect('table.name', 'tableName')
      .addSelect('booking.customerName', 'customerName')
      .addSelect('booking.customerContact', 'customerContact')
      .addSelect('booking.startsAt', 'startsAt')
      .addSelect('booking.endsAt', 'endsAt')
      .addSelect('booking.durationHours', 'durationHours')
      .addSelect('booking.totalAmountIdr', 'totalAmountIdr')
      .addSelect('booking.status', 'status')
      .addSelect('booking.holdExpiresAt', 'holdExpiresAt')
      .orderBy('booking.startsAt', 'DESC')
      .getRawMany();
  }

  /** Creates a 15-minute guest hold and snapshots the current table price. */
  async create(dto: CreateBookingDto) {
    const startsAt = new Date(dto.startsAt);
    this.validateInterval(startsAt, dto.durationHours);
    const endsAt = new Date(startsAt.getTime() + dto.durationHours * 3_600_000);
    const customerName = dto.customerName.trim();
    const customerContact = dto.customerContact.trim();
    if (!customerName || !customerContact) {
      throw new BadRequestException('Customer name and contact are required.');
    }

    try {
      const booking = await this.dataSource.transaction(async (manager) => {
        const tables = manager.getRepository(TableEntity);
        const outlets = manager.getRepository(OutletEntity);
        const bookings = manager.getRepository(BookingEntity);
        const table = await tables.findOne({
          where: {
            id: dto.tableId,
            outletId: dto.outletId,
            condition: 'available',
            archivedAt: IsNull(),
          },
          lock: { mode: 'pessimistic_write' },
        });
        const outlet = await outlets.findOne({
          where: { id: dto.outletId, isActive: true, archivedAt: IsNull() },
        });
        if (!table || !outlet) {
          throw new NotFoundException('Bookable outlet or table not found.');
        }

        await manager.query(
          `UPDATE bookings SET status = 'expired', updated_at = CURRENT_TIMESTAMP
           WHERE table_id = $1 AND status = 'pending' AND hold_expires_at <= CURRENT_TIMESTAMP`,
          [table.id],
        );
        const overlap = await bookings
          .createQueryBuilder('booking')
          .setLock('pessimistic_write')
          .where('booking.tableId = :tableId', { tableId: table.id })
          .andWhere("booking.status IN ('pending', 'confirmed', 'in_progress')")
          .andWhere(
            'booking.startsAt < :endsAt AND booking.endsAt > :startsAt',
            {
              startsAt,
              endsAt,
            },
          )
          .getOne();
        if (overlap) {
          throw new ConflictException(
            'The selected table is no longer available.',
          );
        }

        const hourlyRateIdr = BigInt(table.hourlyRateIdr);
        const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);
        const record = bookings.create({
          reference: `MH${randomUUID().replaceAll('-', '').toUpperCase()}`,
          outletId: table.outletId,
          tableId: table.id,
          userId: null,
          customerName,
          customerContact,
          startsAt,
          endsAt,
          durationHours: dto.durationHours,
          hourlyRateIdr: hourlyRateIdr.toString(),
          totalAmountIdr: (
            hourlyRateIdr * BigInt(dto.durationHours)
          ).toString(),
          status: 'pending',
          holdExpiresAt,
        });
        return bookings.save(record);
      });
      return this.toPublicRecord(booking);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23P01'
      ) {
        throw new ConflictException(
          'The selected table is no longer available.',
        );
      }
      throw error;
    }
  }

  private validateInterval(startsAt: Date, durationHours: number): void {
    if (!Number.isFinite(startsAt.getTime())) {
      throw new BadRequestException('A valid start time is required.');
    }
    if (!Number.isSafeInteger(durationHours) || durationHours < 1) {
      throw new BadRequestException(
        'Duration must be a positive whole number of hours.',
      );
    }
    if (startsAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'Booking start time must be in the future.',
      );
    }
    if (!Number.isSafeInteger(startsAt.getTime() + durationHours * 3_600_000)) {
      throw new BadRequestException('Booking interval is invalid.');
    }
  }

  private toPublicRecord(booking: BookingEntity) {
    return {
      reference: booking.reference,
      outletId: booking.outletId,
      tableId: booking.tableId,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      durationHours: booking.durationHours,
      hourlyRateIdr: booking.hourlyRateIdr,
      totalAmountIdr: booking.totalAmountIdr,
      status: booking.status,
      holdExpiresAt: booking.holdExpiresAt,
    };
  }
}
