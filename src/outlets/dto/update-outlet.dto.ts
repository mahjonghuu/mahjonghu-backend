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
import { IsAscendingRateTiers, RateTierDto } from './rate-tier.dto.js';

/** Optional fields accepted when updating an outlet. */
export class UpdateOutletDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  address?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  rate?: number;

  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(9)
  @ValidateNested({ each: true })
  @Type(() => RateTierDto)
  @IsAscendingRateTiers()
  rateTiers?: RateTierDto[];

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
