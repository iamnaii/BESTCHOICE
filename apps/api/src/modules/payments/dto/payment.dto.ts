import { IsString, IsNumber, IsOptional, Matches, Min } from 'class-validator';

export class RecordPaymentDto {
  @IsString()
  contractId: string;

  @IsNumber()
  installmentNo: number;

  @IsNumber()
  @Min(0.01, { message: 'จำนวนเงินต้องมากกว่า 0' })
  amount: number;

  @IsString()
  @Matches(/^(CASH|BANK_TRANSFER|QR_EWALLET)$/, { message: 'paymentMethod ต้องเป็น CASH, BANK_TRANSFER หรือ QR_EWALLET' })
  paymentMethod: string;

  @IsString()
  @IsOptional()
  evidenceUrl?: string; // บังคับ: สลิปโอนเงิน / หลักฐานการชำระ

  @IsString()
  @IsOptional()
  transactionRef?: string; // เลขอ้างอิงธุรกรรม

  @IsString()
  @IsOptional()
  notes?: string;
}

export class BulkRecordPaymentDto {
  @IsString()
  contractId: string;

  @IsNumber()
  @Min(0.01, { message: 'จำนวนเงินต้องมากกว่า 0' })
  amount: number;

  @IsString()
  @Matches(/^(CASH|BANK_TRANSFER|QR_EWALLET)$/, { message: 'paymentMethod ต้องเป็น CASH, BANK_TRANSFER หรือ QR_EWALLET' })
  paymentMethod: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
