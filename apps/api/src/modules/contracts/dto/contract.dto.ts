import { IsString, IsNumber, IsOptional, IsInt, IsBoolean, Min, Max, Matches } from 'class-validator';

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
