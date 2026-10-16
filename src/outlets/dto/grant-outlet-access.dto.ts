import { IsEmail, IsISO8601, IsOptional, MaxLength } from 'class-validator';

export class GrantOutletAccessDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  expiresAt?: string;
}
