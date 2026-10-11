import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutletEntity } from '../outlets/entities/outlet.entity.js';
import { TableEntity } from '../tables/entities/table.entity.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { BookingEntity } from './entities/booking.entity.js';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([BookingEntity, TableEntity, OutletEntity]),
  ],
  controllers: [BookingsController],
  providers: [BookingsService, JWTAuthGuard],
  exports: [BookingsService],
})
export class BookingsModule {}
