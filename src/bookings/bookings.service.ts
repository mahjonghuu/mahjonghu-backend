import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OutletEntity } from '../outlets/entities/outlet.entity.js';
import { OutletAccessService } from '../outlets/outlet-access.service.js';
import { TableEntity } from '../tables/entities/table.entity.js';
import { BookingAvailabilityDto } from './dto/booking-availability.dto.js';
import { BookingEntity } from './entities/booking.entity.js';

/** Public booking availability, backed by database-enforced exclusivity. */
@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(BookingEntity)
    private readonly bookings: Repository<BookingEntity>,
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
    @InjectRepository(OutletEntity)
    private readonly outlets: Repository<OutletEntity>,
    private readonly outletAccess: OutletAccessService,
  ) {}

  /** Lists bookable tables whose active reservation intervals do not overlap. */
  async findAvailable(
    dto: BookingAvailabilityDto,
    userId: string | null = null,
  ) {
    const startsAt = new Date(dto.startsAt);
    this.validateInterval(startsAt, dto.durationHours);
    if (!(await this.outletAccess.allowed(dto.outletId, userId))) {
      throw new NotFoundException('Outlet tidak ditemukan.');
    }
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

  /** Releases a future booking without changing its DOKU charge or payment session. */
  async cancel(id: string): Promise<Pick<BookingEntity, 'id' | 'status'>> {
    // A single conditional update serializes with the notification's booking row
    // lock and prevents its subsequent success from re-confirming a cancellation.
    const rows: Pick<BookingEntity, 'id' | 'status'>[] =
      await this.bookings.query(
        `UPDATE bookings
         SET status = 'cancelled', hold_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND (status = 'pending' OR (status = 'confirmed' AND starts_at > CURRENT_TIMESTAMP))
         RETURNING id, status`,
        [id],
      );
    if (rows[0]) return rows[0];
    if (!(await this.bookings.findOneBy({ id }))) {
      throw new NotFoundException('Booking tidak ditemukan.');
    }
    throw new ConflictException('Booking tidak dapat dibatalkan.');
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
}
