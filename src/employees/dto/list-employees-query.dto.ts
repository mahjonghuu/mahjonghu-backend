import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** Optional owner filters for the employee list. */
export class ListEmployeesQueryDto {
  @IsOptional()
  @IsUUID()
  outletId?: string;

  /** Defaults to true so deactivated employees remain visible for reactivation. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined ? undefined : value === true || value === 'true',
  )
  @IsBoolean()
  includeInactive?: boolean;
}
