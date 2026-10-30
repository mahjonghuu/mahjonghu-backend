import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsAdvertisementDate } from '../advertisement-schedule.js';

/** Owner input for a new image advertisement and inclusive Jakarta schedule. */
export class CreateAdvertisementDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(699075)
  image!: string;

  @IsAdvertisementDate()
  startsOn!: string;

  @IsAdvertisementDate()
  endsOn!: string;
}
