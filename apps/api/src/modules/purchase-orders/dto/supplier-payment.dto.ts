import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Matches, MaxLength } from 'class-validator';
import { SUPPLIER_PAYMENT_ACCOUNT_CODES } from '../../journal/supplier-payment-accounts';

/**
 * ก้อน 2 (คำตัดสินเจ้าของ 2026-10-05) — บันทึกการจ่ายเงินผู้จัดจำหน่าย: ชนิดรายการโปรแกรมตัดสินเอง ·
 * 2026-10-13 เลือกบัญชีจ่ายได้ (ธนาคาร = สลิปบังคับ ตรวจที่ service · เงินสดย่อย/เงินสดเจ้าของ = ไม่บังคับ)
 */
export class RecordSupplierPaymentDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'วันที่จ่ายไม่ถูกต้อง (YYYY-MM-DD)' })
  paidAt: string;

  @IsNumber({}, { message: 'จำนวนเงินไม่ถูกต้อง' })
  @IsPositive({ message: 'จำนวนเงินต้องมากกว่า 0' })
  amount: number;

  /** บัญชีที่จ่าย — ไม่ส่ง = S11-1202 ธนาคารหน้าร้าน (จ่ายออก) */
  @IsOptional()
  @IsString()
  @IsIn(SUPPLIER_PAYMENT_ACCOUNT_CODES, { message: 'บัญชีจ่ายเงินไม่ถูกต้อง' })
  paymentAccountCode?: string;

  /** สลิปโอน — บังคับเมื่อจ่ายจากบัญชีธนาคาร (service ตรวจ) · เงินสดแนบหลักฐานได้ไม่บังคับ */
  @IsOptional()
  @IsString()
  slipUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  reference?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;

  /** uuid ต่อการเปิดหน้าต่าง — ส่งซ้ำได้รายการเดิม */
  @IsString()
  @IsOptional()
  @MaxLength(64)
  requestId?: string;
}

export class VoidSupplierPaymentDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผลที่ยกเลิกรายการ' })
  @MaxLength(500)
  reason: string;
}

export class SupplierLedgerQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'เดือนไม่ถูกต้อง (YYYY-MM)' })
  month?: string;
}
