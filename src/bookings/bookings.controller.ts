import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CustomerAuthService } from '../auth/customer-auth.service.js';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { BookingAvailabilityDto } from './dto/booking-availability.dto.js';
import { BookingsService } from './bookings.service.js';

/** Public availability and owner-only booking-list and cancellation endpoints. */
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly customerAuth: CustomerAuthService,
  ) {}
  /** Lists persisted bookings for the internal dashboard. */
  @UseGuards(JWTAuthGuard)
  @Get()
  findAllForDashboard() {
    return this.bookings.findAllForDashboard();
  }

  /** Cancels an eligible booking after the customer contacts the owner. */
  @UseGuards(JWTAuthGuard)
  @Patch(':id/cancel')
  cancel(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.bookings.cancel(id);
  }

  /** Returns active, available tables for the requested interval. */
  @Get('availability')
  async findAvailable(
    @Query() query: BookingAvailabilityDto,
    @Req() request: Request,
  ) {
    return this.bookings.findAvailable(
      query,
      await this.customerAuth.currentUser(request),
    );
  }
}
