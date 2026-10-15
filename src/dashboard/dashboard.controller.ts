import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { DashboardSummaryQueryDto } from './dto/dashboard-summary-query.dto.js';
import { DashboardService } from './dashboard.service.js';

/** Serves persisted, backend-calculated dashboard metrics to workspace users. */
@Controller('dashboard')
@UseGuards(JWTAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary(@Query() query: DashboardSummaryQueryDto) {
    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException(
        'Tanggal mulai tidak boleh melewati tanggal akhir.',
      );
    }
    return this.dashboard.summary(query.from, query.to, query.outletId);
  }

  @Get('revenue')
  revenue(@Query() query: DashboardSummaryQueryDto) {
    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException(
        'Tanggal mulai tidak boleh melewati tanggal akhir.',
      );
    }
    return this.dashboard.revenueReport(query.from, query.to, query.outletId);
  }
}
