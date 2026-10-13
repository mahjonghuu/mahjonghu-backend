import { IsDateString, IsInt, IsUUID, Min } from 'class-validator';

/** Table and interval requested as one session in a DOKU checkout. */
export class CreateDokuCheckoutSessionDto {
  @IsUUID()
  tableId!: string;

  @IsDateString({ strict: true })
  startsAt!: string;

  @IsInt()
  @Min(1)
  durationHours!: number;
}
