import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Editable fields accepted when updating a table. */
export class UpdateTableDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(['Tersedia', 'Perawatan'])
  status?: 'Tersedia' | 'Perawatan';
}
