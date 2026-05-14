import { IsString, IsNumber, IsOptional, Matches, Min, IsNotEmpty, MaxLength, IsIn } from 'class-validator';

/** Regex for valid cash/bank account codes: 11-1101..03, 11-1201..03 */
const CASH_CODE_REGEX = /^11-(110[1-3]|120[1-3])$/;

/** Payment case types for the wizard */
export type PaymentCase =
  | 'NORMAL'
  | 'OVERPAY'
  | 'UNDERPAY'
  | 'PARTIAL'
  | 'EARLY_PAYOFF'
  | 'RESCHEDULE'
  | 'OVERPAY_ADVANCE';

/** Payment channel/method enum */
export type PaymentMethod = 'CASH' | 'TRANSFER' | 'QR' | 'PAYSOLUTIONS';

/** Reschedule split mode — 6a (split: fee paid first) or 6b (bundled: fee + installment together) */
export type RescheduleSplitMode = 'SINGLE' | 'SPLIT';

export class PreviewJournalDto {
  /** Look up installmentSchedule by contractId + installmentNo (same unique key as recordPayment) */
  @IsString()
  contractId: string;

  @IsNumber()
  installmentNo: number;

  @IsNumber()
  @Min(0, { message: 'จำนวนเงินต้องไม่ติดลบ' })
  amountReceived: number;

  @IsString()
  @Matches(CASH_CODE_REGEX, { message: 'depositAccountCode ต้องเป็น 11-1101..03 หรือ 11-1201..03' })
  depositAccountCode: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  lateFee?: number;

  @IsOptional()
  @IsString()
  @IsIn(['NORMAL', 'OVERPAY', 'UNDERPAY', 'PARTIAL', 'EARLY_PAYOFF', 'RESCHEDULE', 'OVERPAY_ADVANCE'])
  case?: PaymentCase;

  @IsOptional()
  @IsString()
  toleranceApproverId?: string;

  /** ช่องทางรับชำระ (step 3) */
  @IsOptional()
  @IsString()
  @IsIn(['CASH', 'TRANSFER', 'QR', 'PAYSOLUTIONS'])
  method?: PaymentMethod;

  /** เลขอ้างอิง / เลขโอน (required เมื่อ method !== CASH) */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  referenceNumber?: string;

  /** URL สลิป (S3/GCS URL) */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  slipUrl?: string;

  /** หมายเหตุ */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  memo?: string;

  /** RESCHEDULE: จำนวนวันที่เลื่อน */
  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'จำนวนวันต้องมากกว่า 0' })
  daysToShift?: number;

  /** RESCHEDULE: แบ่งจ่าย (SINGLE = 6b bundled, SPLIT = 6a fee advance first) */
  @IsOptional()
  @IsString()
  @IsIn(['SINGLE', 'SPLIT'])
  splitMode?: RescheduleSplitMode;
}

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
  evidenceUrl?: string; // สลิปโอนเงิน / หลักฐานการชำระ

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

  /** ช่องทางรับชำระจากฝั่งลูกค้า (wizard step 3) */
  @IsOptional()
  @IsString()
  @IsIn(['CASH', 'TRANSFER', 'QR', 'PAYSOLUTIONS'])
  wizardMethod?: PaymentMethod;

  /** เลขอ้างอิงธุรกรรมจาก wizard step 3 */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  referenceNumber?: string;

  /** URL สลิป (S3/GCS) จาก wizard step 3 */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  slipUrl?: string;

  /** หมายเหตุจาก wizard step 3 */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  memo?: string;

  /** RESCHEDULE: จำนวนวันที่เลื่อน */
  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'จำนวนวันต้องมากกว่า 0' })
  daysToShift?: number;

  /** RESCHEDULE: SINGLE = 6b bundled, SPLIT = 6a fee advance first */
  @IsOptional()
  @IsString()
  @IsIn(['SINGLE', 'SPLIT'])
  splitMode?: RescheduleSplitMode;

  /** กรณีการชำระ — ระบุเพื่อให้ service เลือก JE template ที่ถูกต้อง */
  @IsOptional()
  @IsString()
  @IsIn(['NORMAL', 'OVERPAY', 'UNDERPAY', 'PARTIAL', 'EARLY_PAYOFF', 'RESCHEDULE', 'OVERPAY_ADVANCE'])
  case?: PaymentCase;

  /**
   * ค่าปรับชำระล่าช้าที่รวมอยู่ใน `amount` (ถ้ามี).
   * ส่งเป็นข้อมูล advisory จาก wizard เพื่อความโปร่งใส — service จะคำนวณ
   * lateFee ใหม่จากข้อมูลในฐานข้อมูล (Payment.lateFee + late_fee_per_day config)
   * เพื่อเป็น source of truth. ห้ามให้ลูกค้า/พนักงานกำหนดค่าปรับเอง.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  lateFee?: number;
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
