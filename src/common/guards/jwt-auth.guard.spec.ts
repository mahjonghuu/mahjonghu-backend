import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JWTAuthGuard } from './jwt-auth.guard.js';

function context(
  authorization?: string,
  cookie?: string,
  method = 'GET',
  origin?: string,
) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, headers: { authorization, cookie, origin } }),
    }),
  } as never;
}

describe('JWTAuthGuard', () => {
  it('rejects requests without a bearer token', async () => {
    const guard = new JWTAuthGuard({ verifyAsync: vi.fn() } as never);

    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('allows a verified owner bearer or cookie token and rejects customer claims', async () => {
    const verifyAsync = vi
      .fn()
      .mockResolvedValueOnce({ sub: 'owner-id', role: 'owner' })
      .mockResolvedValueOnce({ sub: 'owner-id', role: 'owner' })
      .mockResolvedValueOnce({ sub: 'customer-id', role: 'customer' });
    const guard = new JWTAuthGuard({ verifyAsync } as never);

    await expect(
      guard.canActivate(context('Bearer signed-token')),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(context(undefined, 'ownerToken=signed-token')),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(context('Bearer signed-token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects cookie-authenticated mutations from an untrusted origin', async () => {
    const verifyAsync = vi.fn().mockResolvedValue({
      sub: 'owner-id',
      role: 'owner',
    });
    const guard = new JWTAuthGuard({ verifyAsync } as never);

    await expect(
      guard.canActivate(
        context(
          undefined,
          'ownerToken=signed-token',
          'POST',
          'https://attacker.example',
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects invalid or expired tokens', async () => {
    const guard = new JWTAuthGuard({
      verifyAsync: vi.fn().mockRejectedValue(new Error('expired')),
    } as never);

    await expect(
      guard.canActivate(context('Bearer expired-token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
