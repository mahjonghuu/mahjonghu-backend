import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import { DataSource, EntityManager } from 'typeorm';
import { CreateEmployeeDto } from './dto/create-employee.dto.js';
import { UpdateEmployeeDto } from './dto/update-employee.dto.js';

/** Owner-facing employee record; password material is never returned. */
export type EmployeeRecord = {
  id: string;
  email: string;
  outletId: string;
  outletName: string;
  isActive: boolean;
  createdAt: Date;
};

const BCRYPT_ROUNDS = 12;

/** Owns employee account provisioning and single-outlet assignment. */
@Injectable()
export class EmployeesService {
  constructor(private readonly database: DataSource) {}

  /** Lists employees with their assigned outlet, ordered by normalized email. */
  async list(
    outletId?: string,
    includeInactive = true,
  ): Promise<EmployeeRecord[]> {
    return this.database.query(
      `SELECT u.id, u.email, u.outlet_id AS "outletId",
              o.name AS "outletName", u.is_active AS "isActive",
              u.created_at AS "createdAt"
       FROM users u
       JOIN outlets o ON o.id = u.outlet_id
       WHERE u.role = 'employee'
         AND ($1::uuid IS NULL OR u.outlet_id = $1::uuid)
         AND ($2::boolean OR u.is_active)
       ORDER BY lower(u.email), u.id`,
      [outletId ?? null, includeInactive],
    );
  }

  /** Creates an active employee account bound to one active, non-archived outlet. */
  async create(dto: CreateEmployeeDto): Promise<EmployeeRecord> {
    const email = this.normalizeEmail(dto.email);
    const passwordHash = await hash(dto.password, BCRYPT_ROUNDS);
    try {
      return await this.database.transaction(async (manager) => {
        await this.lockAssignableOutlet(manager, dto.outletId);
        const rows: { id: string }[] = await manager.query(
          `INSERT INTO users
             (auth_subject, email, password_hash, role, outlet_id, is_active)
           VALUES ($1, $2, $3, 'employee', $4, true)
           RETURNING id`,
          [randomUUID(), email, passwordHash, dto.outletId],
        );
        return this.record(manager, rows[0].id);
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Email sudah digunakan.');
      }
      throw error;
    }
  }

  /** Updates credentials, assignment, or activation for an existing employee. */
  async update(id: string, dto: UpdateEmployeeDto): Promise<EmployeeRecord> {
    const email =
      dto.email === undefined ? null : this.normalizeEmail(dto.email);
    const passwordHash =
      dto.password === undefined
        ? null
        : await hash(dto.password, BCRYPT_ROUNDS);
    try {
      return await this.database.transaction(async (manager) => {
        const existing: { id: string; outletId: string | null }[] =
          await manager.query(
            `SELECT id, outlet_id AS "outletId"
             FROM users WHERE id = $1 AND role = 'employee'`,
            [id],
          );
        if (!existing[0]) {
          throw new NotFoundException('Karyawan tidak ditemukan.');
        }
        if (
          dto.outletId !== undefined &&
          dto.outletId !== existing[0].outletId
        ) {
          await this.lockAssignableOutlet(manager, dto.outletId);
        }
        await manager.query(
          `UPDATE users
           SET email = COALESCE($2, email),
               password_hash = COALESCE($3, password_hash),
               outlet_id = COALESCE($4::uuid, outlet_id),
               is_active = COALESCE($5::boolean, is_active),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND role = 'employee'`,
          [id, email, passwordHash, dto.outletId ?? null, dto.isActive ?? null],
        );
        return this.record(manager, id);
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Email sudah digunakan.');
      }
      throw error;
    }
  }

  /** Disables an employee without deleting their account or booking references. */
  async deactivate(id: string): Promise<void> {
    const rows: { id: string }[] = await this.database.query(
      `UPDATE users
       SET is_active = false, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND role = 'employee'
       RETURNING id`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Karyawan tidak ditemukan.');
  }

  private async lockAssignableOutlet(
    manager: EntityManager,
    outletId: string,
  ): Promise<void> {
    const rows: { id: string }[] = await manager.query(
      `SELECT id FROM outlets
       WHERE id = $1 AND is_active = true AND archived_at IS NULL
       FOR SHARE`,
      [outletId],
    );
    if (!rows[0]) {
      throw new BadRequestException('Outlet aktif tidak ditemukan.');
    }
  }

  private async record(
    manager: EntityManager,
    id: string,
  ): Promise<EmployeeRecord> {
    const rows: EmployeeRecord[] = await manager.query(
      `SELECT u.id, u.email, u.outlet_id AS "outletId",
              o.name AS "outletName", u.is_active AS "isActive",
              u.created_at AS "createdAt"
       FROM users u
       JOIN outlets o ON o.id = u.outlet_id
       WHERE u.id = $1 AND u.role = 'employee'`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Karyawan tidak ditemukan.');
    return rows[0];
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private isUniqueViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    if ('code' in error && error.code === '23505') return true;
    if (!('driverError' in error)) return false;
    const driverError = error.driverError;
    return (
      typeof driverError === 'object' &&
      driverError !== null &&
      'code' in driverError &&
      driverError.code === '23505'
    );
  }
}
