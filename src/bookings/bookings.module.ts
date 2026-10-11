import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutletEntity } from '../outlets/entities/outlet.entity.js';
import { TableEntity } from '../tables/entities/table.entity.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { BookingEntity } from './entities/booking.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([BookingEntity, TableEntity, OutletEntity]),
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
