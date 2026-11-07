import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { DashboardAuthGuard } from './dashboard-auth.guard.js';

type TestRequest = {
  method: string;
  headers: {
    authorization?: string;
    cookie?: string;
    origin?: string;
  };
};

function request(
  authorization?: string,
  cookie?: string,
  method = 'GET',
  origin?: string,
): TestRequest {
  return {
    method,
    headers: { authorization, cookie, origin },
  };
}

function context(requestValue: TestRequest) {
  return {
    switchToHttp: () => ({ getRequest: () => requestValue }),
  } as never;
}

function setup(
  claims: { sub: string; role: string },
  user: {
    id: string;
    role: string;
    outletId: string | null;
    isActive: boolean;
    outletActive?: boolean | null;
    outletArchivedAt?: Date | null;
  } | null,
) {
  const row = user
    ? {
        ...user,
        outletActive: user.outletActive ?? (user.outletId ? true : null),
        outletArchivedAt: user.outletArchivedAt ?? null,
      }
    : null;
  const database = { query: vi.fn().mockResolvedValue(row ? [row] : []) };
  return {
    database,
    guard: new DashboardAuthGuard(
      { verifyAsync: vi.fn().mockResolvedValue(claims) } as never,
      database as never,
    ),
  };
}

describe('DashboardAuthGuard', () => {
  it('attaches an active owner actor', async () => {
    const value = request('Bearer token');
    const { guard } = setup(
      { sub: 'owner-id', role: 'owner' },
      { id: 'owner-id', role: 'owner', outletId: null, isActive: true },
    );

    await expect(guard.canActivate(context(value))).resolves.toBe(true);
    expect(value).toMatchObject({
      dashboardActor: { id: 'owner-id', role: 'owner', outletId: null },
    });
  });

  it('attaches an employee outlet from the database instead of the token', async () => {
    const value = request('Bearer token');
    const { guard } = setup(
      { sub: 'employee-id', role: 'employee' },
      {
        id: 'employee-id',
        role: 'employee',
        outletId: 'outlet-1',
        isActive: true,
      },
    );

    await expect(guard.canActivate(context(value))).resolves.toBe(true);
    expect(value).toMatchObject({
      dashboardActor: {
        id: 'employee-id',
        role: 'employee',
        outletId: 'outlet-1',
      },
    });
  });

  it('rejects inactive users and stale role claims', async () => {
    const inactive = setup(
      { sub: 'employee-id', role: 'employee' },
      {
        id: 'employee-id',
        role: 'employee',
        outletId: 'outlet-1',
        isActive: false,
      },
    );
    await expect(
      inactive.guard.canActivate(context(request('Bearer token'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const changedRole = setup(
      { sub: 'employee-id', role: 'employee' },
      { id: 'employee-id', role: 'owner', outletId: null, isActive: true },
    );
    await expect(
      changedRole.guard.canActivate(context(request('Bearer token'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects customer claims and employees without an active outlet', async () => {
    const customer = setup(
      { sub: 'customer-id', role: 'customer' },
      { id: 'customer-id', role: 'customer', outletId: null, isActive: true },
    );
    await expect(
      customer.guard.canActivate(context(request('Bearer token'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const unassigned = setup(
      { sub: 'employee-id', role: 'employee' },
      {
        id: 'employee-id',
        role: 'employee',
        outletId: null,
        isActive: true,
      },
    );
    await expect(
      unassigned.guard.canActivate(context(request('Bearer token'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const inactiveOutlet = setup(
      { sub: 'employee-id', role: 'employee' },
      {
        id: 'employee-id',
        role: 'employee',
        outletId: 'outlet-1',
        isActive: true,
        outletActive: false,
      },
    );
    await expect(
      inactiveOutlet.guard.canActivate(context(request('Bearer token'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects cookie mutations from an untrusted origin before verification', async () => {
    const value = request(
      undefined,
      'ownerToken=token',
      'POST',
      'https://attacker.example',
    );
    const guard = new DashboardAuthGuard(
      { verifyAsync: vi.fn() } as never,
      { query: vi.fn() } as never,
    );

    await expect(guard.canActivate(context(value))).rejects.toMatchObject({
      status: 403,
    });
  });
});
