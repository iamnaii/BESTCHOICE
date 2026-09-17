import { IsString, IsOptional, IsBoolean, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizeThaiPhone } from '../../../utils/thai-phone.util';

/**
 * Skip-tracing contact update DTO (P2 Collections — D6).
 *
 * Used by collectors when a customer becomes unreachable. They can:
 *  - Replace the customer's primary phone with a verified new number
 *  - Replace/add a LINE ID
 *  - Tag the customer as `LOST` so they get filtered out of the active queue
 *
 * `reason` is required to keep the audit trail meaningful — every contact
 * change creates a `SKIP_TRACING_UPDATE` AuditLog row with old/new values.
 */
export class UpdateCustomerContactDto {
  // normalize ก่อน validate (ValidationPipe transform: true) — "081-234 5678" / "+66812345678" ผ่านได้
  // ค่าที่ไม่ใช่สตริงปล่อยผ่านให้ @IsString ปฏิเสธ · service normalize + ตรวจซ้ำอีกชั้น
  @Transform(({ value }) => (typeof value === 'string' ? (normalizeThaiPhone(value) ?? '') : value))
  @IsString()
  @IsOptional()
  @Matches(/^0[0-9]{9}$/, { message: 'เบอร์โทรต้องเป็นเลข 10 หลัก ขึ้นต้นด้วย 0' })
  newPhone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100, { message: 'LINE ID ยาวเกินไป' })
  newLineId?: string;

  @IsBoolean()
  @IsOptional()
  markAsLost?: boolean;

  @IsString()
  @MinLength(3, { message: 'กรุณาระบุเหตุผล (อย่างน้อย 3 ตัวอักษร)' })
  @MaxLength(500, { message: 'เหตุผลยาวเกินไป' })
  reason!: string;
}
