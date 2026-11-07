import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import {
  assertTrustedMutationOrigin,
  readSessionToken,
} from './session-token.js';

/** Verified dashboard identity resolved from the database on every request. */
export type DashboardActor = {
  id: string;
  role: 'owner' | 'employee';
  /** Employee outlet; null for owners. */
  outletId: string | null;
};

/** Express request annotated by {@link DashboardAuthGuard}. */
export type DashboardRequest = Request & { dashboardActor?: DashboardActor };

type DashboardClaims = { sub?: string; role?: string };

type UserRow = {
  id: string;
  role: string;
  outletId: string | null;
  isActive: boolean;
  outletActive: boolean | null;
  outletArchivedAt: Date | null;
};

/**
 * Authenticates owners and employees, then refreshes role, outlet, and active
 * status from PostgreSQL so deactivation and reassignment apply immediately.
 */
@Injectable()
export class DashboardAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly database: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DashboardRequest>();
    const session = readSessionToken(request);
    if (!session) {
      throw new UnauthorizedException('Autentikasi diperlukan.');
    }
    assertTrustedMutationOrigin(request, session.source);

    let claims: DashboardClaims;
    try {
      claims = await this.jwt.verifyAsync<DashboardClaims>(session.token);
    } catch {
      throw new UnauthorizedException('Token tidak valid atau kedaluwarsa.');
    }
    if (
      !claims.sub ||
      (claims.role !== 'owner' && claims.role !== 'employee')
    ) {
      throw new UnauthorizedException('Akses dashboard diperlukan.');
    }

    const rows: UserRow[] = await this.database.query(
      `SELECT u.id, u.role, u.outlet_id AS "outletId",
              u.is_active AS "isActive",
              o.is_active AS "outletActive",
              o.archived_at AS "outletArchivedAt"
       FROM users u
       LEFT JOIN outlets o ON o.id = u.outlet_id
       WHERE u.id = $1`,
      [claims.sub],
    );
    const user = rows[0];
    if (
      !user ||
      !user.isActive ||
      user.role !== claims.role ||
      (user.role !== 'owner' && user.role !== 'employee')
    ) {
      throw new UnauthorizedException('Sesi tidak valid.');
    }
    if (
      user.role === 'employee' &&
      (!user.outletId || user.outletActive !== true || user.outletArchivedAt)
    ) {
      throw new UnauthorizedException('Akun belum memiliki outlet aktif.');
    }

    request.dashboardActor = {
      id: user.id,
      role: user.role,
      outletId: user.outletId ?? null,
    };
    return true;
  }
}
