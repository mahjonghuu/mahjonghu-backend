import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';

export class RequestCustomerCodeDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class VerifyCustomerCodeDto extends RequestCustomerCodeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}
