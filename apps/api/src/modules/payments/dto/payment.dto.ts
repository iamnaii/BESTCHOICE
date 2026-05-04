import { IsString, IsNumber, IsOptional, Matches, Min, IsNotEmpty, MaxLength } from 'class-validator';

/** Regex for valid cash/bank account codes: 11-1101..03, 11-1201..03 */
const CASH_CODE_REGEX = /^11-(110[1-3]|120[1-3])$/;

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

  /** บัญชีรับเงินสด/ธนาคาร เช่น 11-1101 / 11-1201. ถ้าไม่ส่งจะใช้ค่าเริ่มต้นของ user หรือ 11-1101 */
  @IsOptional()
  @IsString()
  @Matches(CASH_CODE_REGEX, { message: 'depositAccountCode ต้องเป็น 11-1101..03 หรือ 11-1201..03' })
  depositAccountCode?: string;

  /**
   * T16: Tolerance approval — required when amountReceived differs from amountDue by 0.01–1.00 ฿.
   * Must be an OWNER, ACCOUNTANT, or BRANCH_MANAGER. Backend validates role and writes TOLERANCE_APPROVED AuditLog.
   */
  @IsOptional()
  @IsString()
  toleranceApproverId?: string;
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
  @MaxLength(2048)
  @Matches(/^https:\/\/.+/, { message: 'evidenceUrl ต้องเป็น HTTPS URL' })
  evidenceUrl?: string; // สลิปโอนเงิน / หลักฐานการชำระ (ติดไว้กับงวดแรกที่สร้าง)

  @IsString()
  @IsOptional()
  notes?: string;

  /** บัญชีรับเงินสด/ธนาคาร เช่น 11-1101 / 11-1201. ถ้าไม่ส่งจะใช้ค่าเริ่มต้นของ user หรือ 11-1101 */
  @IsOptional()
  @IsString()
  @Matches(CASH_CODE_REGEX, { message: 'depositAccountCode ต้องเป็น 11-1101..03 หรือ 11-1201..03' })
  depositAccountCode?: string;
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
