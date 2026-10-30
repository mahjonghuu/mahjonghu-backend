import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { IsAdvertisementDate } from '../advertisement-schedule.js';

/** Partial owner edits; omitted images are retained and explicit null is invalid. */
export class UpdateAdvertisementDto {
  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title?: string;

  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(699075)
  image?: string;

  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsAdvertisementDate()
  startsOn?: string;

  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsAdvertisementDate()
  endsOn?: string;
}
