import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { OutletEntity } from './entities/outlet.entity.js';
import { OutletAccessEntity } from './entities/outlet-access.entity.js';

/** Owner-facing customer grant summary for one outlet. */
export type OutletGrant = {
  userId: string;
  email: string;
  expiresAt: Date | null;
  createdAt: Date;
};

/** Resolves private outlet permissions and manages owner-issued invitations. */
@Injectable()
export class OutletAccessService {
  constructor(
    @InjectRepository(OutletEntity)
    private readonly outlets: Repository<OutletEntity>,
    @InjectRepository(OutletAccessEntity)
    private readonly grants: Repository<OutletAccessEntity>,
    private readonly database: DataSource,
  ) {}

  /** A public outlet needs no identity; a private one needs a live customer grant. */
  async allowed(outletId: string, userId: string | null): Promise<boolean> {
    const rows: { allowed: boolean }[] = await this.outlets.query(
      `SELECT EXISTS (
        SELECT 1 FROM outlets o
        WHERE o.id = $1 AND o.is_active = true AND o.archived_at IS NULL
          AND (o.visibility = 'public' OR ($2::uuid IS NOT NULL AND EXISTS (
            SELECT 1 FROM outlet_access a JOIN users u ON u.id = a.user_id
            WHERE a.outlet_id = o.id AND a.user_id = $2::uuid
              AND u.role = 'customer' AND u.is_active = true
              AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP)
          )))
      ) AS allowed`,
      [outletId, userId],
    );
    return rows[0]?.allowed === true;
  }

  /** Lists customer grants for an existing outlet. */
  async list(outletId: string): Promise<OutletGrant[]> {
    await this.requireOutlet(outletId);
    const rows: OutletGrant[] = await this.grants.query(
      `SELECT a.user_id AS "userId", u.email, a.expires_at AS "expiresAt",
        a.created_at AS "createdAt"
       FROM outlet_access a JOIN users u ON u.id = a.user_id
       WHERE a.outlet_id = $1 ORDER BY a.created_at DESC, a.user_id`,
      [outletId],
    );
    return rows;
  }

  /** Invites or renews a customer; only owners may register an invitation. */
  async grant(
    outletId: string,
    email: string,
    expiresAt?: string,
  ): Promise<OutletGrant> {
    await this.requireOutlet(outletId);
    const normalized = email.trim().toLowerCase();
    const expiry = expiresAt === undefined ? null : new Date(expiresAt);
    if (expiry && (Number.isNaN(expiry.getTime()) || expiry <= new Date())) {
      throw new BadRequestException('Tanggal kedaluwarsa harus di masa depan.');
    }
    return this.database.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO users (auth_subject, email, role, is_active)
         VALUES ($1, $2, 'customer', true) ON CONFLICT DO NOTHING`,
        [randomUUID(), normalized],
      );
      const users: { id: string; role: string; is_active: boolean }[] =
        await manager.query(
          `SELECT id, role, is_active FROM users WHERE lower(btrim(email)) = $1`,
          [normalized],
        );
      const user = users[0];
      if (!user || user.role !== 'customer' || !user.is_active) {
        throw new BadRequestException('Email bukan akun customer aktif.');
      }
      const rows: OutletGrant[] = await manager.query(
        `INSERT INTO outlet_access (outlet_id, user_id, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (outlet_id, user_id) DO UPDATE SET expires_at = EXCLUDED.expires_at
         RETURNING user_id AS "userId", expires_at AS "expiresAt", created_at AS "createdAt"`,
        [outletId, user.id, expiry],
      );
      return { ...rows[0], email: normalized };
    });
  }

  /** Revokes access to an existing outlet without cancelling prior bookings. */
  async revoke(outletId: string, userId: string): Promise<void> {
    await this.requireOutlet(outletId);
    await this.grants.delete({ outletId, userId });
  }

  private async requireOutlet(outletId: string): Promise<void> {
    if (
      !(await this.outlets.findOneBy({ id: outletId, archivedAt: IsNull() }))
    ) {
      throw new NotFoundException('Outlet tidak ditemukan.');
    }
  }
}
