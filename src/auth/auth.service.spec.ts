import { describe, expect, it, vi } from 'vitest';
import { hash } from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service.js';
import { UserEntity } from './entities/user.entity.js';

const ownerId = 'fcd425d6-d339-4430-a87c-5e276aff5879';

function setup(user: UserEntity | null) {
  const users = {
    createQueryBuilder: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(user),
    })),
  };
  const jwt = { signAsync: vi.fn().mockResolvedValue('signed-owner-token') };
  return { service: new AuthService(users as never, jwt as never), jwt };
}

describe('AuthService', () => {
  it('issues a JWT only for an active owner with a matching password', async () => {
    const passwordHash = await hash('strong-owner-password', 4);
    const owner = {
      id: ownerId,
      email: 'owner@example.com',
      passwordHash,
      role: 'owner',
      isActive: true,
    } as UserEntity;
    const { service, jwt } = setup(owner);

    await expect(
      service.login(' OWNER@example.com ', 'strong-owner-password'),
    ).resolves.toEqual({
      accessToken: 'signed-owner-token',
      user: { id: ownerId, email: 'owner@example.com', role: 'owner' },
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: ownerId, role: 'owner' });
  });

  it.each([
    { role: 'customer', isActive: true, passwordHash: 'unused' },
    { role: 'owner', isActive: false, passwordHash: 'unused' },
    { role: 'owner', isActive: true, passwordHash: null },
  ])('rejects accounts that are not eligible owners', async (account) => {
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

  it('rejects an incorrect password', async () => {
    const { service, jwt } = setup({
      id: ownerId,
      email: 'owner@example.com',
      passwordHash: await hash('correct-password', 4),
      role: 'owner',
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
          isActive: true,
        }),
      })),
    };
    const service = new AuthService(users as never, jwt);
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
