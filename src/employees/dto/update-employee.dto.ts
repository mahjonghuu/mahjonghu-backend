import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Owner edits for one employee; omitted fields keep their current value. */
export class UpdateEmployeeDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;

  @IsOptional()
  @IsUUID()
  outletId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
