import 'reflect-metadata';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { fileURLToPath } from 'node:url';
import { AddDokuPaymentSessions1791763200000 } from './migrations/1791763200000-AddDokuPaymentSessions.js';
import { InitialSchema1791590400000 } from './migrations/1791590400000-InitialSchema.js';
import { AddPasswordHashToUsers1791676800000 } from './migrations/1791676800000-AddPasswordHashToUsers.js';
import { AddOutletOperatingHours1791849600000 } from './migrations/1791849600000-AddOutletOperatingHours.js';
import { AddPrivateOutletAccess1791936000000 } from './migrations/1791936000000-AddPrivateOutletAccess.js';
import { AllowOvernightOutletHours1792022400000 } from './migrations/1792022400000-AllowOvernightOutletHours.js';
import { MovePricingToOutlets1792108800000 } from './migrations/1792108800000-MovePricingToOutlets.js';

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
    AddDokuPaymentSessions1791763200000,
    AddOutletOperatingHours1791849600000,
    AddPrivateOutletAccess1791936000000,
    AllowOvernightOutletHours1792022400000,
    MovePricingToOutlets1792108800000,
  ],
});
