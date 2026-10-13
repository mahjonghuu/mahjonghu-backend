import { UseGuards } from '@nestjs/common';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Controller, Get, Query } from '@nestjs/common';
import { BookingAvailabilityDto } from './dto/booking-availability.dto.js';
import { BookingsService } from './bookings.service.js';

/** Public availability and owner-only persisted booking-list endpoints. */
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /** Lists persisted bookings for the internal dashboard. */
  @UseGuards(JWTAuthGuard)
  @Get()
  findAllForDashboard() {
    return this.bookings.findAllForDashboard();
  }

  /** Returns active, available tables for the requested interval. */
  @Get('availability')
  findAvailable(@Query() query: BookingAvailabilityDto) {
    return this.bookings.findAvailable(query);
  }
}
