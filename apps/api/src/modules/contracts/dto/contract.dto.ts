import { IsString, IsNumber, IsOptional, IsInt, IsBoolean, IsPositive, Min, Max, Matches, IsIn } from 'class-validator';
import { KBANK_ACCOUNT_CODE } from '../../../constants/cash-account.constants';

export class CreateContractDto {
  @IsString()
  customerId: string;

  @IsString()
  productId: string;

  @IsString()
  branchId: string;

  @IsString()
  @IsOptional()
  planType?: string = 'STORE_DIRECT';

  @IsNumber()
  @Min(1, { message: 'ราคาขายต้องมากกว่า 0' })
  @Max(9999999, { message: 'ราคาขายต้องไม่เกิน 9,999,999' })
  sellingPrice: number;

  @IsNumber()
  @Min(0, { message: 'เงินดาวน์ต้องไม่น้อยกว่า 0' })
  @Max(9999999, { message: 'เงินดาวน์ต้องไม่เกิน 9,999,999' })
  downPayment: number;

  @IsNumber()
  @IsInt({ message: 'จำนวนงวดต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'จำนวนงวดต้องอย่างน้อย 1 งวด' })
  @Max(120, { message: 'จำนวนงวดต้องไม่เกิน 120 งวด' })
  totalMonths: number;

  @IsNumber()
  @Min(0, { message: 'อัตราดอกเบี้ยต้องไม่น้อยกว่า 0' })
  @Max(100, { message: 'อัตราดอกเบี้ยต้องไม่เกิน 100' })
  @IsOptional()
  interestRate?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  // วันที่ครบกำหนดชำระ ตามวันเงินเดือนออก (1-28 หรือ 31=สิ้นเดือน)
  @IsInt({ message: 'วันครบกำหนดชำระต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'วันครบกำหนดชำระต้องอยู่ระหว่าง 1-31' })
  @Max(31, { message: 'วันครบกำหนดชำระต้องอยู่ระหว่าง 1-31' })
  @IsOptional()
  paymentDueDay?: number;

  /** OWNER/BRANCH_MANAGER อนุญาตให้ลูกค้าผ่อนซ้อนได้ (override active-contract check) */
  @IsBoolean()
  @IsOptional()
  overrideActiveContractCheck?: boolean;
}

export class UpdateContractDto {
  @IsNumber()
  @Min(1, { message: 'ราคาขายต้องมากกว่า 0' })
  @Max(9999999, { message: 'ราคาขายต้องไม่เกิน 9,999,999' })
  @IsOptional()
  sellingPrice?: number;

  @IsNumber()
  @Min(0, { message: 'เงินดาวน์ต้องไม่น้อยกว่า 0' })
  @Max(9999999, { message: 'เงินดาวน์ต้องไม่เกิน 9,999,999' })
  @IsOptional()
  downPayment?: number;

  @IsNumber()
  @IsInt({ message: 'จำนวนงวดต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'จำนวนงวดต้องอย่างน้อย 1 งวด' })
  @Max(120, { message: 'จำนวนงวดต้องไม่เกิน 120 งวด' })
  @IsOptional()
  totalMonths?: number;

  @IsNumber()
  @Min(0, { message: 'อัตราดอกเบี้ยต้องไม่น้อยกว่า 0' })
  @Max(100, { message: 'อัตราดอกเบี้ยต้องไม่เกิน 100' })
  @IsOptional()
  interestRate?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsInt({ message: 'วันครบกำหนดชำระต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'วันครบกำหนดชำระต้องอยู่ระหว่าง 1-31' })
  @Max(31, { message: 'วันครบกำหนดชำระต้องอยู่ระหว่าง 1-31' })
  @IsOptional()
  paymentDueDay?: number;
}

export class EarlyPayoffDto {
  @IsString()
  @Matches(/^(CASH|BANK_TRANSFER|QR_EWALLET)$/, { message: 'paymentMethod ต้องเป็น CASH, BANK_TRANSFER หรือ QR_EWALLET' })
  paymentMethod: string;

  /** ส่วนลดเปอร์เซ็นต์บนกำไรขั้นต้น (0-100) — default 50 */
  @IsOptional()
  discountPct?: number;

  /**
   * Cash dimension: บัญชีรับเงินจริง — ธนาคารกสิกร (11-1201) เท่านั้น
   * (owner rule 2026-07-08: เงินเข้า FINANCE ตรงได้ทางเดียวคือโอนเข้ากสิกร;
   * เงินสดหน้าร้านใช้ collectedByShop → 11-2107). Omitted → 11-1201.
   */
  @IsOptional()
  @IsString()
  @IsIn([KBANK_ACCOUNT_CODE], {
    message: 'บัญชีรับเงินต้องเป็นธนาคารกสิกร (11-1201) เท่านั้น',
  })
  depositAccountCode?: string;

  /** วันที่ชำระ (ISO date) — default = วันนี้ */
  @IsString()
  @IsOptional()
  paymentDate?: string;

  /** URL สลิปโอนเงิน (กรณี BANK_TRANSFER / QR_EWALLET) */
  @IsString()
  @IsOptional()
  slipUrl?: string;

  /** เลขที่อ้างอิงสลิป */
  @IsString()
  @IsOptional()
  referenceNo?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  /**
   * เก็บที่หน้าร้าน — เมื่อ true เซิร์ฟเวอร์จะแทนที่ depositAccountCode ด้วย 11-2107
   * (ลูกหนี้-หน้าร้าน) โดยอัตโนมัติ. Client ไม่ส่ง 11-2107 โดยตรง —
   * ผ่าน flag นี้เท่านั้น เพื่อรักษา @IsIn validator ของ depositAccountCode ไว้สมบูรณ์.
   */
  @IsOptional()
  @IsBoolean()
  collectedByShop?: boolean;
}

export class ReviewContractDto {
  @IsString()
  @IsOptional()
  reviewNotes?: string;
}

export class RejectContractDto {
  @IsString()
  reviewNotes: string; // เหตุผลปฏิเสธ (บังคับ)
}

// ─── P4-SP4: Contract Cancellation DTOs ──────────────────────────────────────

export class RequestCancellationDto {
  @IsString()
  reason: string;

  @IsNumber()
  @Min(0, { message: 'จำนวนเงินคืนต้องไม่ติดลบ' })
  refundAmount: number;
}

export class RejectCancellationDto {
  @IsString()
  reason: string;
}

/**
 * Task 3: Shop→FINANCE settlement — clears the Dr 11-2107 receivable.
 * Posted when the shop remits the collected cash to FINANCE.
 */
export class ShopCollectSettlementDto {
  /**
   * บัญชีรับเงิน (bank) ที่ FINANCE รับโอนจากหน้าร้าน — ธนาคารกสิกร (11-1201)
   * เท่านั้น (owner rule 2026-07-08: หน้าร้านโอนเข้าบัญชีกสิกรของ FINANCE).
   */
  @IsString()
  @IsIn([KBANK_ACCOUNT_CODE], {
    message: 'บัญชีรับเงินต้องเป็นธนาคารกสิกร (11-1201) เท่านั้น',
  })
  depositAccountCode: string;

  /** ยอดชำระ (฿) — ต้องมากกว่า 0 และไม่เกินยอด 11-2107 คงค้างของสัญญา */
  @IsNumber({}, { message: 'ยอดชำระต้องเป็นตัวเลข' })
  @IsPositive({ message: 'ยอดชำระต้องมากกว่า 0' })
  amount: number;
}
