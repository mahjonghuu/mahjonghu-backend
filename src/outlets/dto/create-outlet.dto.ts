import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { HappyHourDto } from './happy-hour.dto.js';
import { IsAscendingRateTiers, RateTierDto } from './rate-tier.dto.js';

/** Fields accepted when creating an outlet. */
export class CreateOutletDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  city!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(240)
  address!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  rate!: number;

  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(9)
  @ValidateNested({ each: true })
  @Type(() => RateTierDto)
  @IsAscendingRateTiers()
  rateTiers?: RateTierDto[];

  @IsOptional()
  @IsIn(['duration', 'happy_hour'])
  pricingMode?: 'duration' | 'happy_hour';

  @ValidateIf((_dto, value: unknown) => value !== undefined && value !== null)
  @ValidateNested()
  @Type(() => HappyHourDto)
  happyHour?: HappyHourDto | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  openingHour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24)
  closingHour?: number;
}
