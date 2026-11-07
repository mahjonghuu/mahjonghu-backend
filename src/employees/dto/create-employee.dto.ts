import {
  IsEmail,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Owner input for creating one employee account and its single outlet. */
export class CreateEmployeeDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsUUID()
  outletId!: string;
}
