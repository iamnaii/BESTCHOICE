import { IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Matches, MaxLength } from 'class-validator';

/** ก้อน 2 (คำตัดสินเจ้าของ 2026-10-05) — บันทึกการจ่ายเงินผู้จัดจำหน่าย: โอนธนาคารเท่านั้น สลิปบังคับ ชนิดรายการโปรแกรมตัดสินเอง */
export class RecordSupplierPaymentDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'วันที่โอนไม่ถูกต้อง (YYYY-MM-DD)' })
  paidAt: string;

  @IsNumber({}, { message: 'จำนวนเงินไม่ถูกต้อง' })
  @IsPositive({ message: 'จำนวนเงินต้องมากกว่า 0' })
  amount: number;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาแนบสลิปโอนเงิน' })
  slipUrl: string;

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
