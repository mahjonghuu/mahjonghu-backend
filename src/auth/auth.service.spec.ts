import { describe, expect, it, vi } from 'vitest';
import { hash } from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service.js';
import { UserEntity } from './entities/user.entity.js';

const ownerId = 'fcd425d6-d339-4430-a87c-5e276aff5879';
const employeeId = '63f60487-caf5-4884-86ab-6318a1a2c020';

function setup(
  user: UserEntity | null,
  outlet: { id: string; isActive: boolean } | null = {
    id: 'outlet-1',
    isActive: true,
  },
) {
  const users = {
    createQueryBuilder: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(user),
    })),
  };
  const outlets = { findOneBy: vi.fn().mockResolvedValue(outlet) };
  const jwt = { signAsync: vi.fn().mockResolvedValue('signed-owner-token') };
  return {
    service: new AuthService(
      users as never,
      outlets as never,
      jwt as never,
    ),
    jwt,
  };
}

describe('AuthService', () => {
  it('issues a JWT for an active owner with a matching password', async () => {
    const passwordHash = await hash('strong-owner-password', 4);
    const owner = {
      id: ownerId,
      email: 'owner@example.com',
      passwordHash,
      role: 'owner',
      outletId: null,
      isActive: true,
    } as UserEntity;
    const { service, jwt } = setup(owner);

    await expect(
      service.login(' OWNER@example.com ', 'strong-owner-password'),
    ).resolves.toEqual({
      accessToken: 'signed-owner-token',
      user: {
        id: ownerId,
        email: 'owner@example.com',
        role: 'owner',
        outletId: null,
      },
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: ownerId, role: 'owner' });
  });

  it('issues an outlet-scoped JWT for an active employee', async () => {
    const passwordHash = await hash('strong-employee-password', 4);
    const { service, jwt } = setup({
      id: employeeId,
      email: 'employee@example.com',
      passwordHash,
      role: 'employee',
      outletId: 'outlet-1',
      isActive: true,
    } as UserEntity);

    await expect(
      service.login('employee@example.com', 'strong-employee-password'),
    ).resolves.toEqual({
      accessToken: 'signed-owner-token',
      user: {
        id: employeeId,
        email: 'employee@example.com',
        role: 'employee',
        outletId: 'outlet-1',
      },
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: employeeId,
      role: 'employee',
      outletId: 'outlet-1',
    });
  });

  it.each([
    { role: 'customer', isActive: true, passwordHash: 'unused' },
    { role: 'owner', isActive: false, passwordHash: 'unused' },
    { role: 'owner', isActive: true, passwordHash: null },
  ])('rejects accounts that cannot sign in', async (account) => {
    const { service, jwt } = setup({
      id: ownerId,
      email: 'owner@example.com',
      ...account,
    } as UserEntity);

    await expect(
      service.login('owner@example.com', 'password'),
    ).rejects.toMatchObject({
      status: 401,
    });
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('rejects an employee without an active outlet assignment', async () => {
    const passwordHash = await hash('employee-password', 4);
    const withoutOutlet = setup(
      {
        id: employeeId,
        email: 'employee@example.com',
        passwordHash,
        role: 'employee',
        outletId: null,
        isActive: true,
      } as UserEntity,
    );
    await expect(
      withoutOutlet.service.login('employee@example.com', 'employee-password'),
    ).rejects.toMatchObject({ status: 401 });

    const inactiveOutlet = setup(
      {
        id: employeeId,
        email: 'employee@example.com',
        passwordHash,
        role: 'employee',
        outletId: 'outlet-1',
        isActive: true,
      } as UserEntity,
      { id: 'outlet-1', isActive: false },
    );
    await expect(
      inactiveOutlet.service.login('employee@example.com', 'employee-password'),
    ).rejects.toMatchObject({ status: 401 });
    expect(inactiveOutlet.jwt.signAsync).not.toHaveBeenCalled();
  });

  it('rejects an incorrect password', async () => {
    const { service, jwt } = setup({
      id: ownerId,
      email: 'owner@example.com',
      passwordHash: await hash('correct-password', 4),
      role: 'owner',
      outletId: null,
      isActive: true,
    } as UserEntity);

    await expect(
      service.login('owner@example.com', 'wrong-password'),
    ).rejects.toMatchObject({
      status: 401,
    });
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('signs an eight-hour HS256 owner token verifiable by the configured JWT service', async () => {
    const jwt = new JwtService({
      secret: 'test-secret-with-at-least-32-characters',
      signOptions: { algorithm: 'HS256', expiresIn: '8h' },
      verifyOptions: { algorithms: ['HS256'] },
    });
    const passwordHash = await hash('secure-password', 4);
    const users = {
      createQueryBuilder: vi.fn(() => ({
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({
          id: ownerId,
          email: 'owner@example.com',
          passwordHash,
          role: 'owner',
          outletId: null,
          isActive: true,
        }),
      })),
    };
    const service = new AuthService(
      users as never,
      { findOneBy: vi.fn() } as never,
      jwt,
    );
    const response = await service.login(
      'owner@example.com',
      'secure-password',
    );
    await expect(jwt.verifyAsync(response.accessToken)).resolves.toMatchObject({
      sub: ownerId,
      role: 'owner',
    });
  });
});
