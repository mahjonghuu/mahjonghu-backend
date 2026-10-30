import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { SupabaseImageStorage } from '../common/storage/supabase-image.storage.js';
import { InitialSchema1791590400000 } from '../database/migrations/1791590400000-InitialSchema.js';
import { AddPasswordHashToUsers1791676800000 } from '../database/migrations/1791676800000-AddPasswordHashToUsers.js';
import { AddDokuPaymentSessions1791763200000 } from '../database/migrations/1791763200000-AddDokuPaymentSessions.js';
import { AddOutletOperatingHours1791849600000 } from '../database/migrations/1791849600000-AddOutletOperatingHours.js';
import { AddPrivateOutletAccess1791936000000 } from '../database/migrations/1791936000000-AddPrivateOutletAccess.js';
import { AllowOvernightOutletHours1792022400000 } from '../database/migrations/1792022400000-AllowOvernightOutletHours.js';
import { MovePricingToOutlets1792108800000 } from '../database/migrations/1792108800000-MovePricingToOutlets.js';
import { AddHappyHourPricing1792195200000 } from '../database/migrations/1792195200000-AddHappyHourPricing.js';
import { AddOutletPhoto1792281600000 } from '../database/migrations/1792281600000-AddOutletPhoto.js';
import { AddAdvertisements1793318400000 } from '../database/migrations/1793318400000-AddAdvertisements.js';
import { AdvertisementsController } from './advertisements.controller.js';
import { AdvertisementsService } from './advertisements.service.js';
import { AdvertisementEntity } from './entities/advertisement.entity.js';

const databaseUrl = process.env.PAYMENTS_TEST_DATABASE_URL;
const schema = `advertisement_test_${randomUUID().replaceAll('-', '')}`;
const image = 'data:image/png;base64,iVBORw0KGgo=';
const ownerId = randomUUID();

/** Exercises real PostgreSQL schedules, migration upgrades and guarded HTTP CRUD. */
describe.skipIf(!databaseUrl)(
  'Advertisements PostgreSQL HTTP integration',
  () => {
    let admin: DataSource;
    let dataSource: DataSource;
    let app: INestApplication<App>;
    let ownerToken: string;
    const images = {
      upload: vi.fn(
        async () =>
          `https://storage.example/advertisement-images/advertisements/${randomUUID()}.png`,
      ),
      remove: vi.fn(async () => undefined),
    };

    beforeAll(async () => {
      admin = new DataSource({ type: 'postgres', url: databaseUrl });
      await admin.initialize();
      await admin.query(`CREATE SCHEMA "${schema}"`);
      dataSource = new DataSource({
        type: 'postgres',
        url: databaseUrl,
        schema,
        extra: { options: `-c search_path=${schema},public` },
        entities: [AdvertisementEntity],
        migrations: [
          InitialSchema1791590400000,
          AddPasswordHashToUsers1791676800000,
          AddDokuPaymentSessions1791763200000,
          AddOutletOperatingHours1791849600000,
          AddPrivateOutletAccess1791936000000,
          AllowOvernightOutletHours1792022400000,
          MovePricingToOutlets1792108800000,
          AddHappyHourPricing1792195200000,
          AddOutletPhoto1792281600000,
          AddAdvertisements1793318400000,
        ],
      });
      await dataSource.initialize();
      // Apply the complete fresh chain, then exercise the advertisement upgrade on existing data.
      await dataSource.runMigrations();
      await dataSource.undoLastMigration();
      await dataSource.query(
        `INSERT INTO outlets (name, city, address) VALUES ('Existing outlet', 'Jakarta', 'Existing address')`,
      );
      await dataSource.runMigrations();

      const jwt = new JwtService({
        secret: 'advertisements-postgres-test-only',
      });
      ownerToken = jwt.sign({ sub: ownerId, role: 'owner' });
      const module = await Test.createTestingModule({
        controllers: [AdvertisementsController],
        providers: [
          AdvertisementsService,
          JWTAuthGuard,
          { provide: JwtService, useValue: jwt },
          {
            provide: getRepositoryToken(AdvertisementEntity),
            useValue: dataSource.getRepository(AdvertisementEntity),
          },
          { provide: SupabaseImageStorage, useValue: images },
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

    beforeEach(async () => {
      await dataSource.query('DELETE FROM advertisements');
      vi.clearAllMocks();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-30T05:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    afterAll(async () => {
      if (app) await app.close();
      if (dataSource?.isInitialized) await dataSource.destroy();
      if (admin?.isInitialized) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.destroy();
      }
    });

    it('preserves preexisting operational records when upgrading and enforces the schedule constraint', async () => {
      expect(
        await dataSource.query(
          `SELECT name FROM outlets WHERE name = 'Existing outlet'`,
        ),
      ).toEqual([{ name: 'Existing outlet' }]);
      await expect(
        dataSource.query(`
      INSERT INTO advertisements (title, image_url, starts_on, ends_on)
      VALUES ('Invalid', 'https://storage.example/test.png', '2026-10-31', '2026-10-30')
    `),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'advertisements_schedule_ck',
      });
      expect(await dataSource.getRepository(AdvertisementEntity).count()).toBe(
        0,
      );
    });

    it('creates, lists, partially updates and deletes through authenticated HTTP while storing URLs only', async () => {
      const create = await request(app.getHttpServer())
        .post('/advertisements')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: '  Tournament  ',
          image,
          startsOn: '2026-10-30',
          endsOn: '2026-10-30',
        })
        .expect(201);
      const id = create.body.id as string;
      expect(create.body).toEqual({
        id,
        title: 'Tournament',
        imageUrl: expect.stringMatching(/^https:\/\//),
        startsOn: '2026-10-30',
        endsOn: '2026-10-30',
        status: 'active',
      });
      const stored = await dataSource
        .getRepository(AdvertisementEntity)
        .findOneByOrFail({ id });
      expect(stored.imageUrl).toBe(create.body.imageUrl);
      expect(stored.startsOn).toBe('2026-10-30');
      expect(stored.endsOn).toBe('2026-10-30');
      expect(JSON.stringify(stored)).not.toContain('data:image');

      const list = await request(app.getHttpServer())
        .get('/advertisements')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(list.body).toEqual([create.body]);
      const publicList = await request(app.getHttpServer())
        .get('/advertisements/public')
        .expect('Cache-Control', 'no-store')
        .expect(200);
      expect(publicList.body).toEqual([create.body]);

      await request(app.getHttpServer())
        .patch(`/advertisements/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Updated', endsOn: '2026-11-01' })
        .expect(200);
      expect(images.upload).toHaveBeenCalledTimes(1);
      expect(images.remove).not.toHaveBeenCalled();
      expect(
        await dataSource
          .getRepository(AdvertisementEntity)
          .findOneByOrFail({ id }),
      ).toMatchObject({
        title: 'Updated',
        imageUrl: create.body.imageUrl,
        startsOn: '2026-10-30',
        endsOn: '2026-11-01',
      });

      const uploads = images.upload.mock.calls.length;
      await request(app.getHttpServer())
        .patch(`/advertisements/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ startsOn: '2026-11-02', image })
        .expect(400);
      expect(images.upload).toHaveBeenCalledTimes(uploads);
      await request(app.getHttpServer())
        .patch(`/advertisements/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ image: null })
        .expect(400);

      const replacement = await request(app.getHttpServer())
        .patch(`/advertisements/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ image })
        .expect(200);
      expect(replacement.body.imageUrl).not.toBe(create.body.imageUrl);
      expect(images.remove).toHaveBeenCalledWith(
        create.body.imageUrl,
        'advertisements',
      );
      const deleted = await request(app.getHttpServer())
        .delete(`/advertisements/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);
      expect(deleted.text).toBe('');
      expect(await dataSource.getRepository(AdvertisementEntity).count()).toBe(
        0,
      );
      expect(images.remove).toHaveBeenCalledWith(
        replacement.body.imageUrl,
        'advertisements',
      );
      await request(app.getHttpServer())
        .delete(`/advertisements/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('filters real rows inclusively at Jakarta midnight and orders ties without leaking other schedules', async () => {
      const rows = [
        [
          '00000000-0000-4000-8000-000000000001',
          'Active older',
          '2026-10-30',
          '2026-10-30',
          '2026-10-20T00:00:00Z',
        ],
        [
          '00000000-0000-4000-8000-000000000002',
          'Active tie B',
          '2026-10-30',
          '2026-10-30',
          '2026-10-21T00:00:00Z',
        ],
        [
          '00000000-0000-4000-8000-000000000003',
          'Scheduled private',
          '2026-10-31',
          '2026-11-01',
          '2026-10-23T00:00:00Z',
        ],
        [
          '00000000-0000-4000-8000-000000000004',
          'Expired private',
          '2026-10-28',
          '2026-10-29',
          '2026-10-24T00:00:00Z',
        ],
        [
          '00000000-0000-4000-8000-000000000000',
          'Active tie A',
          '2026-10-30',
          '2026-10-30',
          '2026-10-21T00:00:00Z',
        ],
      ];
      for (const [id, title, startsOn, endsOn, createdAt] of rows) {
        await dataSource.query(
          `
        INSERT INTO advertisements (id, title, image_url, starts_on, ends_on, created_at)
        VALUES ($1, $2, 'https://storage.example/test.png', $3, $4, $5)
      `,
          [id, title, startsOn, endsOn, createdAt],
        );
      }
      const list = await request(app.getHttpServer())
        .get('/advertisements')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(
        list.body.map((row: { title: string; status: string }) => [
          row.title,
          row.status,
        ]),
      ).toEqual([
        ['Expired private', 'expired'],
        ['Scheduled private', 'scheduled'],
        ['Active tie A', 'active'],
        ['Active tie B', 'active'],
        ['Active older', 'active'],
      ]);
      for (const [instant, titles] of [
        ['2026-10-29T16:59:59.999Z', ['Expired private']],
        [
          '2026-10-29T17:00:00.000Z',
          ['Active tie A', 'Active tie B', 'Active older'],
        ],
        [
          '2026-10-30T16:59:59.999Z',
          ['Active tie A', 'Active tie B', 'Active older'],
        ],
        ['2026-10-30T17:00:00.000Z', ['Scheduled private']],
        ['2026-11-01T17:00:00.000Z', []],
      ] as const) {
        vi.setSystemTime(new Date(instant));
        const response = await request(app.getHttpServer())
          .get('/advertisements/public')
          .expect('Cache-Control', 'no-store')
          .expect(200);
        expect(
          response.body.map((row: { title: string }) => row.title),
        ).toEqual(titles);
        for (const row of response.body) {
          expect(row.status).toBe('active');
          expect(Object.keys(row).sort()).toEqual([
            'endsOn',
            'id',
            'imageUrl',
            'startsOn',
            'status',
            'title',
          ]);
        }
      }
    });
  },
);
