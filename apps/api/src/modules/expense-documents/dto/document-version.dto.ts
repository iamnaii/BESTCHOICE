import { IsISO8601, IsOptional } from 'class-validator';

/**
 * R20 (FX2) — body ของ `POST /expense-documents/:id/approve` และ `POST /expense-documents/:id/post`
 * `expectedUpdatedAt` = `updatedAt` ของใบตามที่หน้าวาด · ใบเงินเดือน (PAYROLL) บังคับใน service (ไม่ส่ง = 409 DOCUMENT_CHANGED)
 * เอกสารอื่นไม่บังคับ — ผู้เรียกเดิมที่ส่ง `{}` หรือไม่ส่ง body ยังใช้ได้
 */
export class ExpenseDocumentVersionDto {
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'expectedUpdatedAt ต้องเป็นวันเวลาแบบ ISO 8601 (เวลาแก้ไขล่าสุดของเอกสารที่เปิดดู)' })
  expectedUpdatedAt?: string;
}
