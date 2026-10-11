import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Editable fields accepted when updating a table. */
export class UpdateTableDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  rate?: number;

  @IsOptional()
  @IsIn(['Tersedia', 'Perawatan'])
  status?: 'Tersedia' | 'Perawatan';
}
