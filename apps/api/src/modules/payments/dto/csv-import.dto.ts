import { IsString, IsOptional } from 'class-validator';

export class ImportPaymentsCsvDto {
  @IsString()
  csv: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;
}
