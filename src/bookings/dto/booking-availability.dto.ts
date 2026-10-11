import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsUUID, Min } from 'class-validator';

/** Inputs used to find tables free for one requested time interval. */
export class BookingAvailabilityDto {
  @IsUUID()
  outletId!: string;

  @IsDateString({ strict: true })
  startsAt!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationHours!: number;
}
