import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/** Optional filters accepted by the dashboard summary endpoint. */
export class DashboardSummaryQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  outletId?: string;
}
