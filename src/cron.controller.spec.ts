import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { CronController } from './cron.controller.js';

const cronPath = '/cron/supabase-keep-alive';
const secret = 'cron-test-secret-that-is-not-a-deployment-secret';

describe('CronController', () => {
  let app: INestApplication<App>;
  let configuredSecret: string | undefined;
  const query = vi.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CronController],
      providers: [
        { provide: ConfigService, useValue: { get: () => configuredSecret } },
        { provide: DataSource, useValue: { query } },
      ],
    }).compile();
    app = module.createNestApplication<INestApplication<App>>();
    app.useLogger(false);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    configuredSecret = secret;
    query.mockReset();
  });

  it('rejects absent and incorrect authorization before accessing the database', async () => {
    await request(app.getHttpServer()).get(cronPath).expect(401);
    await request(app.getHttpServer())
      .get(cronPath)
      .set('Authorization', 'Bearer incorrect-secret')
      .expect(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed when the deployment secret is not configured', async () => {
    for (const value of [undefined, '']) {
      configuredSecret = value;
      await request(app.getHttpServer())
        .get(cronPath)
        .set('Authorization', `Bearer ${value ?? ''}`)
        .expect(401);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('does not report success when the database is unavailable', async () => {
    query.mockRejectedValueOnce(new Error('database unavailable'));
    await request(app.getHttpServer())
      .get(cronPath)
      .set('Authorization', `Bearer ${secret}`)
      .expect(500);
  });
});
