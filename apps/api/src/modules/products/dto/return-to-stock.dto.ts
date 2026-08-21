import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Phase 5 Task 3 — body ของ `POST /products/:id/return-to-stock`
 * (นำเครื่องมือสองที่รับคืนกลับเข้าคลังพร้อมขาย)
 */
export class ReturnToStockDto {
  /** บันทึกเหตุผล/ผลตรวจสภาพ — เก็บลง AuditLog.newValue.note */
  @IsOptional()
  @IsString({ message: 'หมายเหตุต้องเป็นข้อความ' })
  @MaxLength(500, { message: 'หมายเหตุยาวเกิน 500 ตัวอักษร' })
  note?: string;
}
