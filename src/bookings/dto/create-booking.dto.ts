import {
  IsDateString,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Public guest booking details; account identity is never client-selected. */
export class CreateBookingDto {
  @IsUUID()
  outletId!: string;

  @IsUUID()
  tableId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  customerName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  customerContact!: string;

  @IsDateString({ strict: true })
  startsAt!: string;

  @IsInt()
  @Min(1)
  durationHours!: number;
}
