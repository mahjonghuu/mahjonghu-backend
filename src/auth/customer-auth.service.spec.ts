import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomerAuthService } from './customer-auth.service.js';
import { CustomerOtpEntity } from './entities/customer-otp.entity.js';
import type { Request } from 'express';

const email = 'member@example.com';
const customer = {
  id: 'd42c2f2a-581b-4924-9a94-2321f0a4dbca',
  email,
  role: 'customer',
  isActive: true,
};

function setup() {
  const userQuery = {
    where: vi.fn(),
    andWhere: vi.fn(),
    getOne: vi.fn().mockResolvedValue(customer),
  };
  userQuery.where.mockReturnValue(userQuery);
  userQuery.andWhere.mockReturnValue(userQuery);
  const users = {
    createQueryBuilder: vi.fn().mockReturnValue(userQuery),
    findOneBy: vi.fn().mockResolvedValue(customer),
  };
  const challenges = { query: vi.fn().mockResolvedValue([{ email }]) };
  const ipLimits = { query: vi.fn().mockResolvedValue([{ request_count: 1 }]) };
  const manager = {
    findOne: vi.fn(),
    increment: vi.fn(),
    update: vi.fn(),
    getRepository: vi.fn().mockReturnValue({
      createQueryBuilder: () => ({
        where: () => ({
          andWhere: () => ({ getMany: async () => [customer] }),
        }),
      }),
    }),
  };
  const database = {
    transaction: vi.fn(
      (callback: (state: typeof manager) => Promise<unknown>) =>
        callback(manager),
    ),
  };
  const jwt = {
    signAsync: vi.fn().mockResolvedValue('customer-jwt'),
    verifyAsync: vi
      .fn()
      .mockResolvedValue({ sub: customer.id, role: 'customer' }),
  };
  const config = {
    get: vi.fn(
      (key: string, fallback?: string) =>
        ({ RESEND_API_KEY: 'resend-key', EMAIL_FROM: 'noreply@example.com' })[
          key as 'RESEND_API_KEY' | 'EMAIL_FROM'
        ] ?? fallback,
    ),
    getOrThrow: vi.fn().mockReturnValue('secret-for-hashing'),
  };
  const service = new CustomerAuthService(
    users as never,
    challenges as never,
    ipLimits as never,
    database as never,
    jwt as never,
    config as never,
  );
  const request = { ip: '127.0.0.1', method: 'GET', headers: {} } as Request;
  return {
    service,
    users,
    userQuery,
    challenges,
    ipLimits,
    manager,
    jwt,
    config,
    request,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('CustomerAuthService', () => {
  it('refuses code requests without delivery configuration before touching the database', async () => {
    const { service, config, ipLimits, request } = setup();
    config.get.mockReturnValue(undefined);
    await expect(service.requestCode(email, request)).rejects.toMatchObject({
      status: 503,
    });
    expect(ipLimits.query).not.toHaveBeenCalled();
  });

  it('does not send codes or reveal whether an uninvited email exists', async () => {
    const { service, userQuery, challenges, request } = setup();
    userQuery.getOne.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn());
    await expect(service.requestCode(email, request)).resolves.toBeUndefined();
    expect(challenges.query).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rate-limits by IP persistently before sending', async () => {
    const { service, ipLimits, challenges, request } = setup();
    ipLimits.query.mockResolvedValue([{ request_count: 121 }]);
    await expect(service.requestCode(email, request)).rejects.toMatchObject({
      status: 429,
    });
    expect(challenges.query).not.toHaveBeenCalled();
  });

  it('sends a six digit email code while storing only its hash and an expiry', async () => {
    const { service, challenges, request } = setup();
    const send = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', send);
    await service.requestCode(email, request);
    const [, options] = send.mock.calls[0] as [string, { body: string }];
    const payload: unknown = JSON.parse(options.body);
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('text' in payload) ||
      typeof payload.text !== 'string'
    ) {
      throw new Error('Expected email text.');
    }
    const code = payload.text.match(/\b\d{6}\b/)?.[0];
    expect(code).toMatch(/^\d{6}$/);
    const [, params] = challenges.query.mock.calls[0] as [string, string[]];
    expect(params[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(params[1]).not.toBe(code);
  });

  it('fails closed on email delivery errors and invalidates the challenge without exposing the code', async () => {
    const { service, challenges, request } = setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(service.requestCode(email, request)).rejects.toMatchObject({
      status: 503,
    });
    expect(challenges.query).toHaveBeenCalledTimes(2);
    expect(challenges.query.mock.calls[1][1][1]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not email when the per-address cooldown or hourly quota is exhausted', async () => {
    const { service, challenges, request } = setup();
    challenges.query.mockResolvedValueOnce([]);
    vi.stubGlobal('fetch', vi.fn());
    await expect(service.requestCode(email, request)).rejects.toMatchObject({
      status: 429,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects mismatched codes, commits the failed attempt, and never signs a token', async () => {
    const { service, manager, jwt } = setup();
    manager.findOne.mockResolvedValue({
      email,
      codeHash: '0'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
      failedAttempts: 0,
    });
    await expect(service.verifyCode(email, '123456')).rejects.toMatchObject({
      status: 401,
    });
    expect(manager.increment).toHaveBeenCalledWith(
      CustomerOtpEntity,
      { email },
      'failedAttempts',
      1,
    );
    expect(manager.update).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('never reuses consumed or expired codes, even when the hash matches', async () => {
    const { service, manager, jwt } = setup();
    manager.findOne.mockResolvedValue({
      email,
      consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      failedAttempts: 0,
    });
    await expect(service.verifyCode(email, '123456')).rejects.toMatchObject({
      status: 401,
    });
    expect(manager.update).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('consumes valid codes and issues a role-scoped customer token', async () => {
    const { service, manager, jwt, request } = setup();
    const code = '123456';
    const hash = createHmac('sha256', 'secret-for-hashing')
      .update(email)
      .update(':')
      .update(code)
      .digest('hex');
    manager.findOne.mockResolvedValue({
      email,
      codeHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      failedAttempts: 0,
    });
    await expect(service.verifyCode(email, code)).resolves.toMatchObject({
      token: 'customer-jwt',
      user: { id: customer.id },
    });
    expect(manager.update).toHaveBeenCalledWith(
      CustomerOtpEntity,
      { email },
      { consumedAt: expect.any(Date) },
    );
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: customer.id,
      role: 'customer',
    });
    await expect(service.currentUser(request)).resolves.toBeNull();
    request.headers.cookie = 'customerToken=customer-jwt';
    await expect(service.currentUser(request)).resolves.toBe(customer.id);
  });

  it('rejects invalid presented cookies and refuses unsafe cookie requests from other origins', async () => {
    const { service, jwt, request } = setup();
    request.headers.cookie = 'customerToken=invalid';
    jwt.verifyAsync.mockRejectedValue(new Error('invalid token'));
    await expect(service.currentUser(request)).rejects.toMatchObject({
      status: 401,
    });
    request.method = 'POST';
    jwt.verifyAsync.mockResolvedValue({ sub: customer.id, role: 'customer' });
    await expect(service.currentUser(request)).rejects.toMatchObject({
      status: 403,
    });
  });
});
