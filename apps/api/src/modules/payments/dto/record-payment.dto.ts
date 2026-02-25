import { IsString, IsNumber, IsEnum, IsOptional } from 'class-validator';

export class RecordPaymentDto {
  @IsNumber()
  amountPaid: number;

  @IsEnum(['CASH', 'BANK_TRANSFER', 'QR_EWALLET'])
  paymentMethod: string;

  @IsOptional()
  @IsString()
  evidenceUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
