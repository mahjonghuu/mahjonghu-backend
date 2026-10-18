import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import pg from 'pg';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { OutletsModule } from './outlets/outlets.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { AuthModule } from './auth/auth.module.js';
import { TablesModule } from './tables/tables.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        driver: pg,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    AuthModule,
    BookingsModule,
    PaymentsModule,
    TablesModule,
    DashboardModule,
    OutletsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
