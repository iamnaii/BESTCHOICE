import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export const STOCK_ADJUSTMENT_REASONS = [
  'DAMAGED',
  'LOST',
  'FOUND',
  'CORRECTION',
  'WRITE_OFF',
  'OTHER',
] as const;
export type StockAdjustmentReason = (typeof STOCK_ADJUSTMENT_REASONS)[number];

/**
 * คำขอตัดสินค้า (ก้อน 3, 2026-10-05) — ผู้ขอไม่เลือกผู้อนุมัติอีกต่อไป (เจ้าของอนุมัติทุกใบ) และรูปหลักฐาน
 * มาเป็นไฟล์ multipart (`photos`) ผ่าน `AdjustmentPhotosInterceptor` ไม่ใช่ data URI ใน body.
 */
export class CreateStockAdjustmentDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุรหัสสินค้า' })
  productId: string;

  @IsIn(STOCK_ADJUSTMENT_REASONS, {
    message: 'เหตุผลต้องเป็น DAMAGED, LOST, FOUND, CORRECTION, WRITE_OFF หรือ OTHER',
  })
  reason: StockAdjustmentReason;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'หมายเหตุยาวได้ไม่เกิน 1,000 ตัวอักษร' })
  notes?: string;
}
