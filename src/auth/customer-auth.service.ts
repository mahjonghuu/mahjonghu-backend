import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, Repository } from 'typeorm';
import { UserEntity } from './entities/user.entity.js';
import { CustomerOtpEntity } from './entities/customer-otp.entity.js';
import { CustomerOtpIpLimitEntity } from './entities/customer-otp-ip-limit.entity.js';

const INVALID_CODE = 'Kode tidak valid atau kedaluwarsa.';
const RATE_LIMIT = 'Terlalu banyak permintaan. Coba lagi nanti.';

/** Issues email challenges and resolves verified customer cookie sessions. */
@Injectable()
export class CustomerAuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(CustomerOtpEntity)
    private readonly challenges: Repository<CustomerOtpEntity>,
    @InjectRepository(CustomerOtpIpLimitEntity)
    private readonly ipLimits: Repository<CustomerOtpIpLimitEntity>,
    private readonly database: DataSource,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Challenges are single-use, hashed in storage, and limited per email and IP in PostgreSQL. */
  async requestCode(email: string, request: Request): Promise<void> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const from = this.config.get<string>('EMAIL_FROM');
    if (!apiKey || !from) {
      throw new ServiceUnavailableException('Pengiriman kode belum tersedia.');
    }
    const normalized = email.trim().toLowerCase();
    const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const ipHash = createHmac(
      'sha256',
      this.config.getOrThrow<string>('JWT_SECRET'),
    )
      .update(ip)
      .digest('hex');
    const limits: { request_count: number }[] = await this.ipLimits.query(
      `INSERT INTO customer_otp_ip_limits (ip_hash, window_start, request_count)
       VALUES ($1, CURRENT_TIMESTAMP, 1)
       ON CONFLICT (ip_hash) DO UPDATE SET
         window_start = CASE WHEN customer_otp_ip_limits.window_start <= CURRENT_TIMESTAMP - INTERVAL '1 hour'
           THEN CURRENT_TIMESTAMP ELSE customer_otp_ip_limits.window_start END,
         request_count = CASE WHEN customer_otp_ip_limits.window_start <= CURRENT_TIMESTAMP - INTERVAL '1 hour'
           THEN 1 ELSE LEAST(customer_otp_ip_limits.request_count + 1, 121) END
       RETURNING request_count`,
      [ipHash],
    );
    if (limits[0].request_count > 120) {
      throw new HttpException(RATE_LIMIT, HttpStatus.TOO_MANY_REQUESTS);
    }
    const access: { allowed: boolean }[] = await this.users.query(
      `SELECT EXISTS (
        SELECT 1 FROM users u
        JOIN outlet_access a ON a.user_id = u.id
        JOIN outlets o ON o.id = a.outlet_id
        WHERE LOWER(BTRIM(u.email)) = $1
          AND u.role = 'customer' AND u.is_active = true
          AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP)
          AND o.is_active = true AND o.archived_at IS NULL
      ) AS allowed`,
      [normalized],
    );
    if (access[0]?.allowed !== true) {
      throw new ForbiddenException('Email tidak terdaftar.');
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const hash = this.hashCode(normalized, code);
    const rows: { email: string }[] = await this.challenges.query(
      `INSERT INTO customer_otp (email, code_hash, expires_at, last_sent_at, window_start, request_count, failed_attempts)
       VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '10 minutes', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0)
       ON CONFLICT (email) DO UPDATE SET
         code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
         last_sent_at = CURRENT_TIMESTAMP,
         window_start = CASE WHEN customer_otp.window_start <= CURRENT_TIMESTAMP - INTERVAL '1 hour'
           THEN CURRENT_TIMESTAMP ELSE customer_otp.window_start END,
         request_count = CASE WHEN customer_otp.window_start <= CURRENT_TIMESTAMP - INTERVAL '1 hour'
           THEN 1 ELSE customer_otp.request_count + 1 END,
         failed_attempts = 0,
         consumed_at = NULL
       WHERE customer_otp.last_sent_at <= CURRENT_TIMESTAMP - INTERVAL '60 seconds'
         AND (customer_otp.window_start <= CURRENT_TIMESTAMP - INTERVAL '1 hour'
           OR customer_otp.request_count < 5)
       RETURNING email`,
      [normalized, hash],
    );
    if (rows.length === 0) {
      throw new HttpException(RATE_LIMIT, HttpStatus.TOO_MANY_REQUESTS);
    }
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          from,
          to: [normalized],
          subject: 'Kode masuk MahjongHu',
          text: `Kode masuk MahjongHu Anda: ${code}. Berlaku 10 menit. Jangan berikan kode ini kepada siapa pun.`,
        }),
      });
      if (!response.ok) throw new Error('Email delivery failed');
    } catch {
      await this.challenges.query(
        `UPDATE customer_otp SET consumed_at = CURRENT_TIMESTAMP, expires_at = CURRENT_TIMESTAMP
         WHERE email = $1 AND code_hash = $2`,
        [normalized, hash],
      );
      throw new ServiceUnavailableException(
        'Pengiriman kode gagal. Coba lagi nanti.',
      );
    }
  }

  /** A row lock makes attempts and successful consumption atomic across all instances. */
  async verifyCode(email: string, code: string) {
    if (
      !this.config.get<string>('RESEND_API_KEY') ||
      !this.config.get<string>('EMAIL_FROM')
    ) {
      throw new ServiceUnavailableException('Pengiriman kode belum tersedia.');
    }
    const normalized = email.trim().toLowerCase();
    const user = await this.database.transaction(async (manager) => {
      const challenge = await manager.findOne(CustomerOtpEntity, {
        where: { email: normalized },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !challenge ||
        challenge.consumedAt ||
        challenge.expiresAt <= new Date() ||
        challenge.failedAttempts >= 5
      ) {
        throw new UnauthorizedException(INVALID_CODE);
      }
      const expected = Buffer.from(challenge.codeHash, 'hex');
      const actual = Buffer.from(this.hashCode(normalized, code), 'hex');
      if (!timingSafeEqual(expected, actual)) {
        await manager.increment(
          CustomerOtpEntity,
          { email: normalized },
          'failedAttempts',
          1,
        );
        return null;
      }
      const matches: UserEntity[] = await manager
        .getRepository(UserEntity)
        .createQueryBuilder('user')
        .where('LOWER(BTRIM(user.email)) = :email', { email: normalized })
        .andWhere('user.role = :role AND user.isActive = true', {
          role: 'customer',
        })
        .getMany();
      if (!matches[0]) throw new UnauthorizedException(INVALID_CODE);
      await manager.update(
        CustomerOtpEntity,
        { email: normalized },
        { consumedAt: new Date() },
      );
      return matches[0];
    });
    if (!user) throw new UnauthorizedException(INVALID_CODE);
    return {
      token: await this.jwt.signAsync({ sub: user.id, role: 'customer' }),
      user: { id: user.id, email: user.email, role: 'customer' as const },
    };
  }

  /** Missing cookie is optional; a presented invalid cookie never silently becomes a guest. */
  async currentUser(request: Request): Promise<string | null> {
    const cookie = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('customerToken='));
    if (!cookie) return null;
    const token = cookie.slice('customerToken='.length);
    if (!token) throw new UnauthorizedException('Token customer tidak valid.');
    let claims: { sub?: string; role?: string };
    try {
      claims = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Token customer tidak valid.');
    }
    if (claims.role !== 'customer' || !claims.sub) {
      throw new UnauthorizedException('Token customer tidak valid.');
    }
    const user = await this.users.findOneBy({
      id: claims.sub,
      role: 'customer',
      isActive: true,
    });
    if (!user) throw new UnauthorizedException('Token customer tidak valid.');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers.origin !==
        this.config.get('WEB_ORIGIN', 'http://localhost:3000')
    ) {
      throw new ForbiddenException('Origin tidak diizinkan.');
    }
    return user.id;
  }

  /** Returns the active customer profile for a validated session. */
  async profile(
    userId: string,
  ): Promise<{ id: string; email: string; role: 'customer' }> {
    const user = await this.users.findOneByOrFail({
      id: userId,
      role: 'customer',
      isActive: true,
    });
    return { id: user.id, email: user.email, role: 'customer' };
  }

  private hashCode(email: string, code: string): string {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET'))
      .update(email)
      .update(':')
      .update(code)
      .digest('hex');
  }
}
