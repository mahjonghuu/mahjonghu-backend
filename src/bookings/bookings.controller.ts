import { UseGuards } from '@nestjs/common';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { BookingAvailabilityDto } from './dto/booking-availability.dto.js';
import { CreateBookingDto } from './dto/create-booking.dto.js';
import { BookingsService } from './bookings.service.js';

/** Public guest endpoints for discovering availability and placing booking holds. */
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

  /** Places a temporary booking hold without accepting client-supplied pricing. */
  @Post()
  create(@Body() dto: CreateBookingDto) {
    return this.bookings.create(dto);
  }
}
