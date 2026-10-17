import { IsString, Matches, MaxLength } from 'class-validator';

/** Phone number for public reservation lookup. */
export class BookingLookupDto {
  @IsString()
  @Matches(/^\+?[0-9][0-9\s-]{7,30}$/)
  @MaxLength(32)
  phone!: string;
}
