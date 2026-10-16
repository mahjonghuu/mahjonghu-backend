import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingEntity } from '../bookings/entities/booking.entity.js';
import { OutletEntity } from '../outlets/entities/outlet.entity.js';
import { OutletsModule } from '../outlets/outlets.module.js';
import { TableEntity } from '../tables/entities/table.entity.js';
import { DokuClientService } from './doku-client.service.js';
import { PaymentEntity } from './entities/payment.entity.js';
import { PaymentSessionEntity } from './entities/payment-session.entity.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

@Module({
  imports: [
    AuthModule,
    OutletsModule,
    TypeOrmModule.forFeature([
      BookingEntity,
      OutletEntity,
      TableEntity,
      PaymentEntity,
      PaymentSessionEntity,
    ]),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, DokuClientService],
})
export class PaymentsModule {}
