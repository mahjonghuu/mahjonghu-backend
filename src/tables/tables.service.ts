import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { OutletEntity } from '../outlets/entities/outlet.entity.js';
import { CreateTableDto } from './dto/create-table.dto.js';
import { UpdateTableDto } from './dto/update-table.dto.js';
import { TableEntity } from './entities/table.entity.js';

type TableStatus = 'Tersedia' | 'Digunakan' | 'Perawatan';
type TableRecord = {
  id: string;
  outletId: string;
  name: string;
  status: TableStatus;
};

/** Owns table persistence and derives occupancy from in-progress bookings. */
@Injectable()
export class TablesService {
  constructor(
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
    @InjectRepository(OutletEntity)
    private readonly outlets: Repository<OutletEntity>,
  ) {}

  /** Lists active tables; active bookings take precedence over table condition. */
  async findAll(): Promise<TableRecord[]> {
    const rows = await this.tables.query(`
      SELECT t.id, t.outlet_id AS "outletId", t.name,
        t.condition,
        EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.table_id = t.id AND b.outlet_id = t.outlet_id
            AND b.status = 'in_progress'
        ) AS occupied
      FROM mahjong_tables t
      JOIN outlets o ON o.id = t.outlet_id
      WHERE t.archived_at IS NULL AND o.archived_at IS NULL
      ORDER BY t.created_at ASC, t.id ASC
    `);
    return rows.map((row: Record<string, unknown>) => this.toRecord(row));
  }

  /** Lists tables for public discovery, excluding inactive outlets. */
  async findPublic(userId: string | null = null): Promise<TableRecord[]> {
    const rows = await this.tables.query(
      `
      SELECT t.id, t.outlet_id AS "outletId", t.name,
        t.condition,
        EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.table_id = t.id AND b.outlet_id = t.outlet_id
            AND b.status = 'in_progress'
        ) AS occupied
      FROM mahjong_tables t
      JOIN outlets o ON o.id = t.outlet_id
      WHERE t.archived_at IS NULL AND o.archived_at IS NULL AND o.is_active = true
        AND (o.visibility = 'public' OR EXISTS (
          SELECT 1 FROM outlet_access a
          JOIN users u ON u.id = a.user_id
          WHERE a.outlet_id = o.id AND a.user_id = $1::uuid
            AND u.is_active = true
            AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP)
        ))
      ORDER BY t.created_at ASC, t.id ASC
    `,
      [userId],
    );
    return rows.map((row: Record<string, unknown>) => this.toRecord(row));
  }

  /** Creates a table in an active outlet. */
  async create(dto: CreateTableDto): Promise<TableRecord> {
    const outlet = await this.outlets.findOneBy({
      id: dto.outletId,
      archivedAt: IsNull(),
    });
    if (!outlet) throw new NotFoundException('Outlet tidak ditemukan.');
    if (!outlet.isActive)
      throw new ConflictException(
        'Outlet nonaktif tidak dapat menerima meja baru.',
      );

    const table = this.tables.create({
      outletId: outlet.id,
      name: this.requiredText(dto.name),
      condition: dto.status === 'Perawatan' ? 'maintenance' : 'available',
      archivedAt: null,
    });
    return this.saveWithConflict(table);
  }

  /** Updates a table's name and non-occupancy condition. */
  async update(id: string, dto: UpdateTableDto): Promise<TableRecord> {
    const table = await this.findOne(id);
    if (dto.status !== undefined && (await this.isOccupied(id))) {
      throw new ConflictException(
        'Meja sedang digunakan dan statusnya tidak dapat diubah.',
      );
    }
    if (dto.name !== undefined) table.name = this.requiredText(dto.name);
    if (dto.status !== undefined)
      table.condition =
        dto.status === 'Perawatan' ? 'maintenance' : 'available';
    return this.saveWithConflict(table);
  }

  /** Archives a table only when it has no booking history. */
  async archive(id: string): Promise<void> {
    const table = await this.findOne(id);
    const bookings: { hasBookings: boolean }[] = await this.tables.query(
      'SELECT EXISTS (SELECT 1 FROM bookings WHERE table_id = $1) AS "hasBookings"',
      [id],
    );
    if (bookings[0]?.hasBookings)
      throw new ConflictException(
        'Meja memiliki riwayat reservasi dan tidak dapat dihapus.',
      );
    table.archivedAt = new Date();
    await this.tables.save(table);
  }

  private async findOne(id: string): Promise<TableEntity> {
    const table = await this.tables.findOneBy({ id, archivedAt: IsNull() });
    if (!table) throw new NotFoundException('Meja tidak ditemukan.');
    return table;
  }

  private async isOccupied(id: string): Promise<boolean> {
    const rows: { occupied: boolean }[] = await this.tables.query(
      `SELECT EXISTS (SELECT 1 FROM bookings WHERE table_id = $1 AND status = 'in_progress') AS occupied`,
      [id],
    );
    return rows[0]?.occupied === true;
  }

  private requiredText(value: string): string {
    const text = value.trim();
    if (!text) throw new ConflictException('Nama meja tidak boleh kosong.');
    return text;
  }

  private toRecord(row: Record<string, unknown>): TableRecord {
    return {
      id: String(row.id),
      outletId: String(row.outletId),
      name: String(row.name),
      status:
        row.occupied === true
          ? 'Digunakan'
          : row.condition === 'maintenance'
            ? 'Perawatan'
            : 'Tersedia',
    };
  }

  private async saveWithConflict(table: TableEntity): Promise<TableRecord> {
    try {
      const saved = await this.tables.save(table);
      return {
        id: saved.id,
        outletId: saved.outletId,
        name: saved.name,
        status: saved.condition === 'maintenance' ? 'Perawatan' : 'Tersedia',
      };
    } catch (cause) {
      if (
        typeof cause === 'object' &&
        cause !== null &&
        'code' in cause &&
        cause.code === '23505'
      )
        throw new ConflictException('Nama meja sudah digunakan di outlet ini.');
      throw cause;
    }
  }
}
