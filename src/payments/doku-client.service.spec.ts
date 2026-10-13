import { createHash, createHmac } from 'node:crypto';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DokuClientService } from './doku-client.service.js';

function createClient(environment: 'dev' | 'prod' = 'dev') {
  const values: Record<string, string> = {
    DOKU_DEV_CLIENT_ID: 'sandbox-merchant',
    DOKU_DEV_SECRET_KEY: 'sandbox-secret',
    DOKU_PROD_CLIENT_ID: 'production-merchant',
    DOKU_PROD_SECRET_KEY: 'production-secret',
  };
  const config = {
    get: vi.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  return { service: new DokuClientService(config), values, environment };
}

function signedNotification(
  clientId: string,
  secret: string,
  body: Buffer,
  requestId: string,
  timestamp: string,
  path: string,
) {
  const digest = createHash('sha256').update(body).digest('base64');
  const raw = [
    `Client-Id:${clientId}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${timestamp}`,
    `Request-Target:${path}`,
    `Digest:${digest}`,
  ].join('\n');
  return `HMACSHA256=${createHmac('sha256', secret).update(raw).digest('base64')}`;
}

describe('DokuClientService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('creates a sandbox checkout with a signed 15-minute request and trusted expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T08:15:00.000Z'));
    const { service } = createClient();
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          response: {
            payment: {
              url: 'https://sandbox.doku.com/checkout-link/token',
              token_id: 'sandbox-token',
              expired_date: '20261012153000',
            },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetch);

    const result = await service.createCheckout('dev', {
      invoiceNumber: 'MH1234567890123456789012345678',
      amount: 150_000,
      customerName: 'Ada Guest',
      customerPhone: '081234567890',
      customerEmail: 'ada@example.com',
      callbackUrl: 'https://booking.example.com/payment/result/MH123',
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe('https://api-sandbox.doku.com/checkout/v1/payment');
    const request = fetch.mock.calls[0][1] as RequestInit;
    const requestBody = JSON.parse(String(request.body));
    expect(requestBody.order).toMatchObject({ amount: 150_000, currency: 'IDR' });
    expect(requestBody.payment.payment_due_date).toBe(15);
    expect(requestBody.customer.email).toBe('ada@example.com');
    expect(new Headers(request.headers).get('Signature')).toMatch(/^HMACSHA256=/);
    expect(result).toEqual({
      checkoutUrl: 'https://sandbox.doku.com/checkout-link/token',
      dokuSessionId: 'sandbox-token',
      expiresAt: new Date('2026-10-12T08:30:00.000Z'),
    });
  });

  it('refuses production checkout with an insecure customer return URL', async () => {
    const { service } = createClient('prod');

    await expect(service.createCheckout('prod', {
      invoiceNumber: 'MH123',
      amount: 75_000,
      customerName: 'Ada Guest',
      customerPhone: '081234567890',
      customerEmail: 'ada@example.com',
      callbackUrl: 'http://localhost:3000/payment/result/MH123',
    })).rejects.toThrow(ServiceUnavailableException);
  });

  it('authenticates DOKU notification signatures over the raw body and exact callback path', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T08:15:00.000Z'));
    const { service } = createClient();
    const path = '/payments/doku/dev/notification';
    const body = Buffer.from('{"transaction":{"status":"SUCCESS"}}');
    const requestId = 'notification-123';
    const timestamp = '2026-10-12T08:15:00Z';
    const signature = signedNotification(
      'sandbox-merchant',
      'sandbox-secret',
      body,
      requestId,
      timestamp,
      path,
    );
    const headers = {
      'client-id': 'sandbox-merchant',
      'request-id': requestId,
      'request-timestamp': timestamp,
      signature,
    };

    expect(service.verifyNotification('dev', headers, body, path)).toBe(requestId);
    expect(() =>
      service.verifyNotification('dev', headers, Buffer.from(`${body} `), path),
    ).toThrow(UnauthorizedException);
    expect(() =>
      service.verifyNotification('dev', headers, body, '/payments/doku/prod/notification'),
    ).toThrow(UnauthorizedException);
  });

  it('rejects notification timestamps outside the five-minute replay window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T08:15:00.000Z'));
    const { service } = createClient();
    const path = '/payments/doku/dev/notification';
    const body = Buffer.from('{"transaction":{"status":"SUCCESS"}}');
    const timestamp = '2026-10-12T08:09:59Z';
    const requestId = 'old-notification';
    const signature = signedNotification(
      'sandbox-merchant',
      'sandbox-secret',
      body,
      requestId,
      timestamp,
      path,
    );

    expect(() => service.verifyNotification(
      'dev',
      {
        'client-id': 'sandbox-merchant',
        'request-id': requestId,
        'request-timestamp': timestamp,
        signature,
      },
      body,
      path,
    )).toThrow(UnauthorizedException);
  });
});
