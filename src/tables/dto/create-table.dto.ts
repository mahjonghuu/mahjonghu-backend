import {
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Fields accepted when creating a table. */
export class CreateTableDto {
  @IsUUID()
  outletId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  rate!: number;

  @IsIn(['Tersedia', 'Perawatan'])
  status!: 'Tersedia' | 'Perawatan';
}
