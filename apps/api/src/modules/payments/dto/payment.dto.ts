import { IsString, IsNumber, IsOptional, IsDateString } from 'class-validator';

export class RecordPaymentDto {
  @IsString()
  contractId: string;

  @IsNumber()
  installmentNo: number;

  @IsNumber()
  amount: number;

  @IsString()
  paymentMethod: string; // CASH, BANK_TRANSFER, QR_EWALLET

  @IsString()
  @IsOptional()
  evidenceUrl?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class BulkRecordPaymentDto {
  @IsString()
  contractId: string;

  @IsNumber()
  amount: number;

  @IsString()
  paymentMethod: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
