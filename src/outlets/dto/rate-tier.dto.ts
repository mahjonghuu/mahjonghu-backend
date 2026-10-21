import { IsInt, Max, Min, ValidateBy } from 'class-validator';

/** Effective hourly rate starting at this whole-hour duration. */
export class RateTierDto {
  @IsInt()
  @Min(2)
  @Max(10)
  durationHours!: number;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  rate!: number;
}

/** Ordered thresholds cannot repeat a duration. */
export const IsAscendingRateTiers = () =>
  ValidateBy({
    name: 'isAscendingRateTiers',
    validator: {
      validate(value: unknown): boolean {
        if (!Array.isArray(value)) return false;
        let previous = 1;
        for (const tier of value) {
          if (
            typeof tier !== 'object' ||
            tier === null ||
            !('durationHours' in tier) ||
            typeof tier.durationHours !== 'number' ||
            tier.durationHours <= previous
          )
            return false;
          previous = tier.durationHours;
        }
        return true;
      },
      defaultMessage: () =>
        'rateTiers must have unique durationHours in ascending order.',
    },
  });
