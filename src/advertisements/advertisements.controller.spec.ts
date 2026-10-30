import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { AdvertisementsController } from './advertisements.controller.js';
import { AdvertisementsService } from './advertisements.service.js';

const id = 'd280d90f-8617-4022-b784-e93470ae6a30';
const body = {
  title: 'Tournament',
  image: 'data:image/png;base64,iVBORw0KGgo=',
  startsOn: '2026-10-30',
  endsOn: '2026-10-30',
};

describe('AdvertisementsController owner boundary', () => {
  let app: INestApplication<App>;
  const service = {
    findAll: vi.fn(),
    findPublic: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
  const jwt = new JwtService({ secret: 'advertisement-controller-test-only' });
  const ownerToken = jwt.sign({ sub: id, role: 'owner' });
  const customerToken = jwt.sign({ sub: id, role: 'customer' });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdvertisementsController],
      providers: [
        { provide: AdvertisementsService, useValue: service },
        { provide: JwtService, useValue: jwt },
        JWTAuthGuard,
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
    vi.clearAllMocks();
  });

  it.each(['get', 'post', 'patch', 'delete'] as const)(
    'rejects anonymous and customer %s requests',
    async (method) => {
      const path =
        method === 'patch' || method === 'delete'
          ? `/advertisements/${id}`
          : '/advertisements';
      for (const token of [undefined, customerToken]) {
        const operation = request(app.getHttpServer())[method](path);
        if (token) operation.set('Authorization', `Bearer ${token}`);
        await operation.send(body).expect(401);
      }
      for (const operation of [
        service.findAll,
        service.create,
        service.update,
        service.remove,
      ]) {
        expect(operation).not.toHaveBeenCalled();
      }
    },
  );

  it('keeps public discovery available without a cookie and sends no-store', async () => {
    service.findPublic.mockResolvedValueOnce([]);
    await request(app.getHttpServer())
      .get('/advertisements/public')
      .expect('Cache-Control', 'no-store')
      .expect(200);
    expect(service.findAll).not.toHaveBeenCalled();
  });

  it('preserves the native cookie-origin requirement before owner mutations', async () => {
    await request(app.getHttpServer())
      .post('/advertisements')
      .set('Cookie', `ownerToken=${ownerToken}`)
      .set('Origin', 'https://untrusted.example')
      .send(body)
      .expect(403);
    expect(service.create).not.toHaveBeenCalled();
  });

  it.each([
    { image: null },
    { image: undefined },
    { title: '   ' },
    { title: 'x'.repeat(81) },
    { startsOn: '2026-02-29' },
    { endsOn: '2026-10-30T00:00:00Z' },
    { startsOn: null },
    { imageUrl: 'https://untrusted.example/image.png' },
  ])('rejects invalid create bodies before the service: %j', async (patch) => {
    await request(app.getHttpServer())
      .post('/advertisements')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...body, ...patch })
      .expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it.each([
    { image: null },
    { title: null },
    { startsOn: null },
    { endsOn: '2026-04-31' },
  ])(
    'does not treat explicit null or invalid dates as omitted partial fields: %j',
    async (patch) => {
      await request(app.getHttpServer())
        .patch(`/advertisements/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(patch)
        .expect(400);
      expect(service.update).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed UUIDs before update and delete', async () => {
    await request(app.getHttpServer())
      .patch('/advertisements/not-a-uuid')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'New' })
      .expect(400);
    await request(app.getHttpServer())
      .delete('/advertisements/not-a-uuid')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
    expect(service.update).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });
});
