import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { CustomerAuthService } from '../auth/customer-auth.service.js';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';

const bookingId = '5cd4efff-203d-41c9-a945-80b9599dc502';

describe('BookingsController', () => {
  let app: INestApplication<App>;
  const cancel = vi.fn();
  const lookupByPhone = vi.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [
        { provide: BookingsService, useValue: { cancel, lookupByPhone } },
        { provide: CustomerAuthService, useValue: {} },
        JWTAuthGuard,
        {
          provide: JwtService,
          useValue: {
            verifyAsync: vi.fn(async (token: string) => ({
              sub: 'owner-id',
              role: token === 'owner-token' ? 'owner' : 'customer',
            })),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication<App>();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    cancel.mockReset();
    lookupByPhone.mockReset();
  });

  it('rejects missing or malformed phones and legacy reference fields', async () => {
    for (const body of [
      {},
      { phone: '123' },
      { phone: '089512345678', reference: 'MHOLDINVOICE' },
      { phone: '089512345678', customerName: 'Ada' },
    ]) {
      await request(app.getHttpServer())
        .post('/bookings/lookup')
        .send(body)
        .expect(400);
    }
    expect(lookupByPhone).not.toHaveBeenCalled();
  });

  it('requires an authenticated owner', async () => {
    await request(app.getHttpServer())
      .patch(`/bookings/${bookingId}/cancel`)
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/bookings/${bookingId}/cancel`)
      .set('Authorization', 'Bearer customer-token')
      .expect(401);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('rejects malformed ids before calling the service', async () => {
    await request(app.getHttpServer())
      .patch('/bookings/not-a-uuid/cancel')
      .set('Authorization', 'Bearer owner-token')
      .expect(400);
    expect(cancel).not.toHaveBeenCalled();
  });
});
