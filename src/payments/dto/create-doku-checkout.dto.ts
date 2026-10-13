import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateDokuCheckoutSessionDto } from './create-doku-checkout-session.dto.js';

/** Guest identity and requested intervals for one multi-table checkout. */
export class CreateDokuCheckoutDto {
  @IsUUID()
  outletId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  customerName!: string;

  @IsString()
  @Matches(/^\+?[0-9][0-9\s-]{7,30}$/)
  @MaxLength(32)
  customerPhone!: string;

  @IsEmail()
  @MaxLength(254)
  customerEmail!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateDokuCheckoutSessionDto)
  sessions!: CreateDokuCheckoutSessionDto[];
}
