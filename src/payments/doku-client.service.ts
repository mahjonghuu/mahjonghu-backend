import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

export type DokuEnvironment = 'dev' | 'prod';

/** Creates signed DOKU Checkout requests and verifies signed notifications. */
@Injectable()
export class DokuClientService {
  constructor(private readonly config: ConfigService) {}

  private isHttpsUrl(value: string) {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }

  async createCheckout(
    environment: DokuEnvironment,
    order: {
      invoiceNumber: string;
      amount: number;
      customerName: string;
      customerPhone: string;
      customerEmail: string;
      callbackUrl: string;
      notificationUrl?: string;
    },
  ) {
    const credentials = this.credentials(environment);
    if (
      environment === 'prod' &&
      (!this.isHttpsUrl(order.callbackUrl) ||
        (order.notificationUrl !== undefined &&
          !this.isHttpsUrl(order.notificationUrl)))
    ) {
      throw new ServiceUnavailableException(
        'DOKU production membutuhkan URL callback HTTPS yang dapat dijangkau publik.',
      );
    }
    const requestTarget = '/checkout/v1/payment';
    const requestId = randomUUID();
    const requestTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const body: Record<string, unknown> = {
      order: {
        amount: order.amount,
        invoice_number: order.invoiceNumber,
        currency: 'IDR',
        callback_url: order.callbackUrl,
        callback_url_result: order.callbackUrl,
        auto_redirect: true,
      },
      payment: { payment_due_date: 15 },
      customer: {
        name: order.customerName,
        phone: order.customerPhone.replace(/^0/, '62').replace(/\D/g, ''),
        email: order.customerEmail,
        country: 'ID',
      },
    };
    if (order.notificationUrl) {
      body.additional_info = {
        override_notification_url: order.notificationUrl,
      };
    }
    const serialized = JSON.stringify(body);
    const digest = createHash('sha256').update(serialized).digest('base64');
    const signature = this.signature(
      credentials.secretKey,
      [
        `Client-Id:${credentials.clientId}`,
        `Request-Id:${requestId}`,
        `Request-Timestamp:${requestTimestamp}`,
        `Request-Target:${requestTarget}`,
        `Digest:${digest}`,
      ].join('\n'),
    );
    const endpoint =
      environment === 'dev'
        ? 'https://api-sandbox.doku.com'
        : 'https://api.doku.com';

    let response: Response;
    try {
      response = await fetch(`${endpoint}${requestTarget}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Client-Id': credentials.clientId,
          'Request-Id': requestId,
          'Request-Timestamp': requestTimestamp,
          Signature: signature,
        },
        body: serialized,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BadGatewayException('DOKU Checkout tidak dapat dijangkau.');
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload !== 'object') {
      throw new BadGatewayException(
        'DOKU menolak pembuatan halaman pembayaran.',
      );
    }
    const payment = checkoutPayment(payload);
    if (!payment) {
      throw new BadGatewayException(
        'DOKU tidak mengembalikan detail pembayaran.',
      );
    }
    let checkoutUrl: URL;
    try {
      checkoutUrl = new URL(payment.url);
    } catch {
      throw new BadGatewayException(
        'DOKU mengembalikan URL pembayaran yang tidak valid.',
      );
    }
    if (
      checkoutUrl.protocol !== 'https:' ||
      !checkoutUrl.hostname.endsWith('.doku.com')
    ) {
      throw new BadGatewayException(
        'DOKU mengembalikan host pembayaran yang tidak valid.',
      );
    }
    let expiresAt = new Date(Date.now() + 15 * 60_000);
    if (payment.expiresAt && /^\d{14}$/.test(payment.expiresAt)) {
      const [, year, month, day, hour, minute, second] =
        /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(
          payment.expiresAt,
        ) ?? [];
      if (year && month && day && hour && minute && second) {
        expiresAt = new Date(
          Date.UTC(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour) - 7,
            Number(minute),
            Number(second),
          ),
        );
      }
    }
    return {
      checkoutUrl: checkoutUrl.toString(),
      dokuSessionId: payment.tokenId,
      expiresAt,
    };
  }

  verifyNotification(
    environment: DokuEnvironment,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
    requestTarget: string,
  ): string {
    const credentials = this.credentials(environment);
    const header = (name: string) => {
      const value = headers[name.toLowerCase()];
      return Array.isArray(value) ? value[0] : value;
    };
    const clientId = header('client-id');
    const requestId = header('request-id');
    const timestamp = header('request-timestamp');
    const receivedSignature = header('signature');
    if (
      clientId !== credentials.clientId ||
      !requestId ||
      !timestamp ||
      !receivedSignature ||
      !Number.isFinite(Date.parse(timestamp)) ||
      Math.abs(Date.now() - Date.parse(timestamp)) > 5 * 60_000
    ) {
      throw new UnauthorizedException('Notifikasi DOKU tidak valid.');
    }
    const digest = createHash('sha256').update(rawBody).digest('base64');
    const expected = this.signature(
      credentials.secretKey,
      [
        `Client-Id:${clientId}`,
        `Request-Id:${requestId}`,
        `Request-Timestamp:${timestamp}`,
        `Request-Target:${requestTarget}`,
        `Digest:${digest}`,
      ].join('\n'),
    );
    const received = Buffer.from(receivedSignature);
    const expectedBuffer = Buffer.from(expected);
    if (
      received.length !== expectedBuffer.length ||
      !timingSafeEqual(received, expectedBuffer)
    ) {
      throw new UnauthorizedException(
        'Tanda tangan notifikasi DOKU tidak valid.',
      );
    }
    return requestId;
  }

  private signature(secretKey: string, components: string): string {
    return `HMACSHA256=${createHmac('sha256', secretKey)
      .update(components)
      .digest('base64')}`;
  }

  private credentials(environment: DokuEnvironment) {
    const prefix = environment === 'dev' ? 'DOKU_DEV' : 'DOKU_PROD';
    const clientId = this.config.get<string>(`${prefix}_CLIENT_ID`);
    const secretKey = this.config.get<string>(`${prefix}_SECRET_KEY`);
    if (!clientId || !secretKey) {
      throw new ServiceUnavailableException(
        `Konfigurasi ${prefix}_CLIENT_ID dan ${prefix}_SECRET_KEY belum tersedia.`,
      );
    }
    return { clientId, secretKey };
  }
}

function checkoutPayment(value: unknown) {
  if (!value || typeof value !== 'object' || !('response' in value))
    return null;
  const response = value.response;
  if (!response || typeof response !== 'object' || !('payment' in response)) {
    return null;
  }
  const payment = response.payment;
  if (!payment || typeof payment !== 'object' || !('url' in payment))
    return null;
  if (typeof payment.url !== 'string') return null;
  return {
    url: payment.url,
    tokenId:
      'token_id' in payment && typeof payment.token_id === 'string'
        ? payment.token_id
        : null,
    expiresAt:
      'expired_date' in payment && typeof payment.expired_date === 'string'
        ? payment.expired_date
        : null,
  };
}
