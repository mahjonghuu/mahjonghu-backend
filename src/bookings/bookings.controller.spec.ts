import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { CustomerAuthService } from '../auth/customer-auth.service.js';
import { DashboardAuthGuard } from '../common/guards/dashboard-auth.guard.js';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';

const bookingId = '5cd4efff-203d-41c9-a945-80b9599dc502';

describe('BookingsController', () => {
  let app: INestApplication<App>;
  const cancel = vi.fn();
  const lookupByPhone = vi.fn();
  const findAllForDashboard = vi.fn();

  beforeAll(async () => {
    const users = {
      'owner-id': {
        id: 'owner-id',
        role: 'owner',
        outletId: null,
        isActive: true,
        outletActive: null,
        outletArchivedAt: null,
      },
      'employee-id': {
        id: 'employee-id',
        role: 'employee',
        outletId: 'outlet-1',
        isActive: true,
        outletActive: true,
        outletArchivedAt: null,
      },
    };
    const module = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [
        {
          provide: BookingsService,
          useValue: { cancel, lookupByPhone, findAllForDashboard },
        },
        { provide: CustomerAuthService, useValue: {} },
        JWTAuthGuard,
        DashboardAuthGuard,
        {
          provide: JwtService,
          useValue: {
            verifyAsync: vi.fn(async (token: string) => {
              if (token === 'owner-token') {
                return { sub: 'owner-id', role: 'owner' };
              }
              if (token === 'employee-token') {
                return { sub: 'employee-id', role: 'employee' };
              }
              return { sub: 'customer-id', role: 'customer' };
            }),
          },
        },
        {
          provide: DataSource,
          useValue: {
            query: vi.fn(async (_sql: string, [id]: [string]) => [
              users[id as keyof typeof users],
            ]),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication<INestApplication<App>>();
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
    findAllForDashboard.mockReset();
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

  it('allows employees to read only their outlet booking history', async () => {
    findAllForDashboard.mockResolvedValue([]);
    await request(app.getHttpServer())
      .get('/bookings')
      .set('Authorization', 'Bearer employee-token')
      .expect(200)
      .expect([]);
    expect(findAllForDashboard).toHaveBeenCalledWith('outlet-1');
  });

  it('keeps cancellation owner-only', async () => {
    await request(app.getHttpServer())
      .patch(`/bookings/${bookingId}/cancel`)
      .set('Authorization', 'Bearer employee-token')
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
