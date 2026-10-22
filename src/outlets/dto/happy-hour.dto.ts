import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  Max,
  Min,
  ValidateBy,
} from 'class-validator';

/** Local calendar weekdays and whole-hour window used instead of duration tiers. */
export class HappyHourDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  @ValidateBy({
    name: 'uniqueHappyHourDays',
    validator: {
      validate: (days: unknown) => Array.isArray(days) && new Set(days).size === days.length,
      defaultMessage: () => 'happyHour.days must be unique ISO weekdays.',
    },
  })
  days!: number[];

  @IsInt()
  @Min(0)
  @Max(23)
  startHour!: number;

  @IsInt()
  @Min(1)
  @Max(24)
  @ValidateBy({
    name: 'happyHourEndAfterStart',
    validator: {
      validate: (endHour: unknown, args) => {
        const startHour = (args?.object as HappyHourDto | undefined)?.startHour;
        return typeof endHour === 'number' && typeof startHour === 'number' && endHour > startHour;
      },
      defaultMessage: () => 'happyHour.endHour must be after startHour.',
    },
  })
  endHour!: number;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  rate!: number;
}
