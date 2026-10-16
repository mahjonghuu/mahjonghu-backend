import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CustomerAuthService } from '../auth/customer-auth.service.js';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { BookingAvailabilityDto } from './dto/booking-availability.dto.js';
import { BookingsService } from './bookings.service.js';

/** Public availability and owner-only persisted booking-list endpoints. */
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
