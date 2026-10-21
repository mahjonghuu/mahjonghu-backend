import {
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
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

  @IsIn(['Tersedia', 'Perawatan'])
  status!: 'Tersedia' | 'Perawatan';
}
