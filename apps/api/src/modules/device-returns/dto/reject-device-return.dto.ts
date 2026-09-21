import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/** POST /device-returns/:id/reject — spec 2026-09-20 §5.3 (reason 10–500 ตัวอักษร) */
export class RejectDeviceReturnDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'กรุณาระบุเหตุผลที่ส่งกลับ' })
  @MinLength(10, { message: 'กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร' })
  @MaxLength(500, { message: 'เหตุผลยาวได้ไม่เกิน 500 ตัวอักษร' })
  reason: string;
}
