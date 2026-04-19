import { IsString, IsNumber, IsOptional, Matches, Min, IsNotEmpty, MaxLength } from 'class-validator';

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
  @MaxLength(2048)
  @Matches(/^https:\/\/.+/, { message: 'evidenceUrl ต้องเป็น HTTPS URL' })
  evidenceUrl?: string; // บังคับ: สลิปโอนเงิน / หลักฐานการชำระ

  @IsString()
  @IsOptional()
  @MaxLength(255)
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

export class WaiveLateFeeDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผลการยกเว้นค่าปรับ' })
  reason: string;

  // T1-C2 — 4-eyes (Segregation of Duties). No self-approval is allowed,
  // regardless of amount; a different manager-tier user must be named as
  // the approver for every waiver.
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุผู้อนุมัติ (approverId)' })
  approverId: string;
}
