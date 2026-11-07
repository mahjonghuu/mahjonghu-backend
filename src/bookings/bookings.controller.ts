import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CustomerAuthService } from '../auth/customer-auth.service.js';
import {
  DashboardAuthGuard,
  type DashboardRequest,
} from '../common/guards/dashboard-auth.guard.js';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { BookingAvailabilityDto } from './dto/booking-availability.dto.js';
import { BookingLookupDto } from './dto/booking-lookup.dto.js';
import { BookingsService } from './bookings.service.js';

/** Public availability and lookup, plus owner/employee booking operations. */
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly customerAuth: CustomerAuthService,
  ) {}

  /** Returns public reservation details for every checkout matching this phone. */
  @HttpCode(200)
  @Post('lookup')
  lookup(@Body() dto: BookingLookupDto) {
    return this.bookings.lookupByPhone(dto.phone);
  }

  /** Lists persisted bookings; employees only receive their assigned outlet. */
  @UseGuards(DashboardAuthGuard)
  @Get()
  findAllForDashboard(@Req() request: DashboardRequest) {
    const actor = request.dashboardActor!;
    return this.bookings.findAllForDashboard(
      actor.role === 'employee' ? actor.outletId : null,
    );
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
