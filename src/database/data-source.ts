import 'reflect-metadata';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { fileURLToPath } from 'node:url';
import { InitialSchema1791590400000 } from './migrations/1791590400000-InitialSchema.js';
import { AddPasswordHashToUsers1791676800000 } from './migrations/1791676800000-AddPasswordHashToUsers.js';

// TypeORM CLI does not bootstrap Nest, so initialize Nest ConfigModule explicitly before the DataSource.
await ConfigModule.forRoot({
  envFilePath: fileURLToPath(new URL('../../.env', import.meta.url)),
});
const config = new ConfigService();

/** CLI connection for explicit, versioned migrations; importing this file never connects or migrates. */
export default new DataSource({
  type: 'postgres',
  url: config.getOrThrow<string>('DATABASE_URL'),
  synchronize: false,
  migrationsRun: false,
  migrations: [
    InitialSchema1791590400000,
    AddPasswordHashToUsers1791676800000,
  ],
});
