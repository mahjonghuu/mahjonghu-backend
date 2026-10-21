import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { InitialSchema1791590400000 } from '../src/database/migrations/1791590400000-InitialSchema.js';
import { MovePricingToOutlets1792108800000 } from '../src/database/migrations/1792108800000-MovePricingToOutlets.js';

const databaseUrl = process.env.PAYMENTS_TEST_DATABASE_URL;
const schema = `pricing_migration_test_${randomUUID().replaceAll('-', '')}`;

describe.skipIf(!databaseUrl)(
  'MovePricingToOutlets PostgreSQL migration',
  () => {
    let admin: DataSource;
    let dataSource: DataSource;

    beforeAll(async () => {
      admin = new DataSource({ type: 'postgres', url: databaseUrl });
      await admin.initialize();
      await admin.query(`CREATE SCHEMA "${schema}"`);
      dataSource = new DataSource({
        type: 'postgres',
        url: databaseUrl,
        schema,
        extra: { options: `-c search_path=${schema},public` },
        migrations: [InitialSchema1791590400000],
      });
      await dataSource.initialize();
      await dataSource.runMigrations();
    });

    afterAll(async () => {
      if (dataSource?.isInitialized) await dataSource.destroy();
      if (admin?.isInitialized) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.destroy();
      }
    });

    it('rejects conflicting legacy rates without dropping pricing, then transfers aligned rates', async () => {
      const outlets = (await dataSource.query(`
      INSERT INTO outlets (name, city, address) VALUES
        ('Legacy', 'Jakarta', 'Test street'), ('Empty', 'Jakarta', 'Test street')
      RETURNING id, name
    `)) as { id: string; name: string }[];
      const legacyId = outlets.find((outlet) => outlet.name === 'Legacy')!.id;
      const emptyId = outlets.find((outlet) => outlet.name === 'Empty')!.id;
      const tables = (await dataSource.query(
        `
      INSERT INTO mahjong_tables (outlet_id, name, hourly_rate_idr)
      VALUES ($1, 'One', 100000), ($1, 'Two', 110000)
      RETURNING id, name
    `,
        [legacyId],
      )) as { id: string; name: string }[];
      const migration = new MovePricingToOutlets1792108800000();
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      try {
        await runner.startTransaction();
        await expect(migration.up(runner)).rejects.toThrow(
          /Legacy.*tables have different hourly rates/,
        );
        await runner.rollbackTransaction();
        const legacyColumn = (await dataSource.query(
          `
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'mahjong_tables' AND column_name = 'hourly_rate_idr'
      `,
          [schema],
        )) as { column_name: string }[];
        expect(legacyColumn).toHaveLength(1);

        await dataSource.query(
          `UPDATE mahjong_tables SET hourly_rate_idr = 100000 WHERE id = $1`,
          [tables.find((table) => table.name === 'Two')!.id],
        );
        await runner.startTransaction();
        await migration.up(runner);
        await runner.commitTransaction();
        const prices = (await dataSource.query(
          `
        SELECT id, hourly_rate_idr AS "rate", rate_tiers AS "tiers" FROM outlets WHERE id IN ($1, $2)
      `,
          [legacyId, emptyId],
        )) as { id: string; rate: string; tiers: unknown[] }[];
        expect(prices.find((row) => row.id === legacyId)).toMatchObject({
          rate: '100000',
          tiers: [],
        });
        expect(prices.find((row) => row.id === emptyId)).toMatchObject({
          rate: '75000',
          tiers: [],
        });
        const tablePricing = (await dataSource.query(
          `
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'mahjong_tables'
          AND column_name = 'hourly_rate_idr'
      `,
          [schema],
        )) as { column_name: string }[];
        expect(tablePricing).toEqual([]);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
      }
    });
  },
);
