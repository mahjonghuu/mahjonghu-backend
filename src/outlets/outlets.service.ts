import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CreateOutletDto } from './dto/create-outlet.dto.js';
import type { RateTierDto } from './dto/rate-tier.dto.js';
import type { HappyHourDto } from './dto/happy-hour.dto.js';
import { UpdateOutletDto } from './dto/update-outlet.dto.js';
import { OutletEntity } from './entities/outlet.entity.js';

type OutletSummary = {
  id: string;
  name: string;
  city: string;
  address: string;
  visibility: 'public' | 'private';
  rate: number;
  rateTiers: RateTierDto[];
  pricingMode: 'duration' | 'happy_hour';
  happyHour: HappyHourDto | null;
  active: boolean;
  openingHour: number;
  closingHour: number;
  tableCount: number;
  occupiedTableCount: number;
};

type OutletDetail = Omit<OutletSummary, 'tableCount' | 'occupiedTableCount'>;

/** Owns outlet validation and persistence for the operational dashboard. */
@Injectable()
export class OutletsService {
  constructor(
    @InjectRepository(OutletEntity)
    private readonly outlets: Repository<OutletEntity>,
  ) {}

  /** Lists non-archived outlets with live table counts. */
  async findAll(): Promise<OutletSummary[]> {
    const rows = await this.outlets.query(`
      SELECT
        o.id,
        o.name,
        o.city,
        o.address,
        o.is_active AS active,
        o.visibility,
        o.opening_hour AS "openingHour",
        o.closing_hour AS "closingHour",
        o.hourly_rate_idr AS rate, o.rate_tiers AS "rateTiers",
        o.pricing_mode AS "pricingMode", o.happy_hour AS "happyHour",
        (SELECT count(*) FROM mahjong_tables t
          WHERE t.outlet_id = o.id AND t.archived_at IS NULL) AS "tableCount",
        (SELECT count(DISTINCT b.table_id) FROM bookings b
          WHERE b.outlet_id = o.id AND b.status = 'in_progress') AS "occupiedTableCount"
      FROM outlets o
      WHERE o.archived_at IS NULL
      ORDER BY o.created_at ASC, o.id ASC
    `);
    return rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      name: String(row.name),
      city: String(row.city),
      address: String(row.address),
      visibility: row.visibility as 'public' | 'private',
      active: row.active === true,
      rate: Number(row.rate),
      rateTiers: row.rateTiers as RateTierDto[],
      pricingMode: row.pricingMode as 'duration' | 'happy_hour',
      happyHour: row.happyHour as HappyHourDto | null,
      openingHour: Number(row.openingHour),
      closingHour: Number(row.closingHour),
      tableCount: Number(row.tableCount),
      occupiedTableCount: Number(row.occupiedTableCount),
    }));
  }

  /** Lists active, non-archived outlets for public discovery. */
  async findPublic(userId: string | null = null): Promise<OutletSummary[]> {
    const rows = await this.outlets.query(
      `
      SELECT
        o.id, o.name, o.city, o.address, o.is_active AS active,
        o.visibility,
        o.opening_hour AS "openingHour", o.closing_hour AS "closingHour",
        o.hourly_rate_idr AS rate, o.rate_tiers AS "rateTiers",
        o.pricing_mode AS "pricingMode", o.happy_hour AS "happyHour",
        (SELECT count(*) FROM mahjong_tables t
          WHERE t.outlet_id = o.id AND t.archived_at IS NULL) AS "tableCount",
        (SELECT count(DISTINCT b.table_id) FROM bookings b
          WHERE b.outlet_id = o.id AND b.status = 'in_progress') AS "occupiedTableCount"
      FROM outlets o
      WHERE o.archived_at IS NULL AND o.is_active = true
        AND (o.visibility = 'public' OR ($1::uuid IS NOT NULL AND EXISTS (
          SELECT 1 FROM outlet_access a JOIN users u ON u.id = a.user_id
          WHERE a.outlet_id = o.id AND a.user_id = $1::uuid
            AND u.role = 'customer' AND u.is_active = true
            AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP)
        )))
      ORDER BY o.created_at ASC, o.id ASC
    `,
      [userId],
    );
    return rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      name: String(row.name),
      city: String(row.city),
      address: String(row.address),
      active: row.active === true,
      visibility: row.visibility as 'public' | 'private',
      openingHour: Number(row.openingHour),
      rate: Number(row.rate),
      rateTiers: row.rateTiers as RateTierDto[],
      pricingMode: row.pricingMode as 'duration' | 'happy_hour',
      happyHour: row.happyHour as HappyHourDto | null,
      closingHour: Number(row.closingHour),
      tableCount: Number(row.tableCount),
      occupiedTableCount: Number(row.occupiedTableCount),
    }));
  }

  /** Creates a normalized outlet and maps duplicate active names to HTTP 409. */
  async create(dto: CreateOutletDto): Promise<OutletDetail> {
    const pricingMode = dto.pricingMode ?? 'duration';
    this.validatePricing(pricingMode, dto.rateTiers ?? [], dto.happyHour ?? null);
    const outlet = this.outlets.create({
      name: this.requiredText(dto.name, 'name'),
      city: this.requiredText(dto.city, 'city'),
      address: this.requiredText(dto.address, 'address'),
      hourlyRateIdr: String(dto.rate),
      rateTiers: dto.rateTiers ?? [],
      pricingMode,
      happyHour: dto.happyHour ?? null,
      visibility: dto.visibility ?? 'public',
      isActive: dto.active ?? true,
      openingHour: dto.openingHour ?? 12,
      closingHour: dto.closingHour ?? 22,
    });
    if (outlet.closingHour === outlet.openingHour) {
      throw new BadRequestException(
        'Jam tutup tidak boleh sama dengan jam buka.',
      );
    }
    return this.toDetail(await this.saveWithConflict(outlet));
  }

  /** Updates outlet details; in-use bookings prevent deactivation. */
  async update(id: string, dto: UpdateOutletDto): Promise<OutletDetail> {
    const outlet = await this.findOne(id);
    if (dto.name !== undefined)
      outlet.name = this.requiredText(dto.name, 'name');
    if (dto.city !== undefined)
      outlet.city = this.requiredText(dto.city, 'city');
    if (dto.address !== undefined)
      outlet.address = this.requiredText(dto.address, 'address');
    if (dto.rate !== undefined) outlet.hourlyRateIdr = String(dto.rate);
    const pricingMode = dto.pricingMode ?? outlet.pricingMode ?? 'duration';
    const switching = pricingMode !== (outlet.pricingMode ?? 'duration');
    const rateTiers = dto.rateTiers ?? (switching ? [] : outlet.rateTiers ?? []);
    const happyHour = dto.happyHour === null
      ? null
      : dto.happyHour ?? (switching ? null : outlet.happyHour ?? null);
    this.validatePricing(pricingMode, rateTiers, happyHour);
    outlet.pricingMode = pricingMode;
    outlet.rateTiers = rateTiers;
    outlet.happyHour = happyHour;
    if (
      dto.active === false &&
      outlet.isActive &&
      (await this.hasInProgressBooking(id))
    ) {
      throw new ConflictException(
        'Selesaikan penggunaan meja sebelum menonaktifkan outlet.',
      );
    }
    if (dto.active !== undefined) outlet.isActive = dto.active;
    if (dto.visibility !== undefined) outlet.visibility = dto.visibility;
    if (dto.openingHour !== undefined) outlet.openingHour = dto.openingHour;
    if (dto.closingHour !== undefined) outlet.closingHour = dto.closingHour;
    if (outlet.closingHour === outlet.openingHour) {
      throw new BadRequestException(
        'Jam tutup tidak boleh sama dengan jam buka.',
      );
    }
    return this.toDetail(await this.saveWithConflict(outlet));
  }

  /** Archives an outlet only when it has no tables or booking history. */
  async archive(id: string): Promise<void> {
    const outlet = await this.findOne(id);
    const tableRows: { hasTables: boolean }[] = await this.outlets.query(
      'SELECT EXISTS (SELECT 1 FROM mahjong_tables WHERE outlet_id = $1) AS "hasTables"',
      [id],
    );
    const bookingRows: { hasBookings: boolean }[] = await this.outlets.query(
      'SELECT EXISTS (SELECT 1 FROM bookings WHERE outlet_id = $1) AS "hasBookings"',
      [id],
    );
    const hasTables = tableRows[0].hasTables;
    const hasBookings = bookingRows[0].hasBookings;
    if (hasTables || hasBookings) {
      throw new ConflictException(
        'Outlet masih memiliki meja atau riwayat reservasi dan tidak dapat dihapus.',
      );
    }
    outlet.isActive = false;
    outlet.archivedAt = new Date();
    await this.outlets.save(outlet);
  }

  private async findOne(id: string): Promise<OutletEntity> {
    const outlet = await this.outlets.findOneBy({ id, archivedAt: IsNull() });
    if (!outlet) throw new NotFoundException('Outlet tidak ditemukan.');
    return outlet;
  }

  private requiredText(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized)
      throw new BadRequestException(`${field} tidak boleh kosong.`);
    return normalized;
  }

  private async hasInProgressBooking(outletId: string): Promise<boolean> {
    const [{ occupied }] = (await this.outlets.query(
      "SELECT EXISTS (SELECT 1 FROM bookings WHERE outlet_id = $1 AND status = 'in_progress') AS occupied",
      [outletId],
    )) as [{ occupied: boolean }];
    return occupied;
  }

  private toDetail(outlet: OutletEntity): OutletDetail {
    return {
      id: outlet.id,
      name: outlet.name,
      city: outlet.city,
      address: outlet.address,
      visibility: outlet.visibility,
      active: outlet.isActive,
      openingHour: outlet.openingHour,
      closingHour: outlet.closingHour,
      rate: Number(outlet.hourlyRateIdr),
      rateTiers: outlet.rateTiers,
      pricingMode: outlet.pricingMode ?? 'duration',
      happyHour: outlet.happyHour ?? null,
    };
  }

  private validatePricing(
    mode: 'duration' | 'happy_hour',
    tiers: RateTierDto[],
    happyHour: HappyHourDto | null,
  ): void {
    if (mode === 'happy_hour' ? !happyHour || tiers.length > 0 : happyHour !== null) {
      throw new BadRequestException(
        'Mode happy hour membutuhkan jadwal dan tidak dapat memakai rate tiers.',
      );
    }
  }

  private async saveWithConflict(outlet: OutletEntity): Promise<OutletEntity> {
    try {
      return await this.outlets.save(outlet);
    } catch (error) {
      const driverError = (error as { driverError?: { code?: string } })
        .driverError;
      if (driverError?.code === '23505') {
        throw new ConflictException('Nama outlet sudah digunakan.');
      }
      throw error;
    }
  }
}
