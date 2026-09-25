import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';

export class UpdateFinanceApplicationDto {
  @IsOptional() @IsUUID('4', { message: 'รหัสลูกค้าไม่ถูกต้อง' }) customerId?: string;
  @IsOptional() @IsUUID('4', { message: 'รหัสสินค้าไม่ถูกต้อง' }) productId?: string;
  @IsOptional() @IsString() @MaxLength(80, { message: 'อาชีพยาวเกิน 80 ตัวอักษร' }) occupationOverride?: string;
  /** แก้ถ้อยคำเฉพาะใบนี้ (บรรทัดลิงก์ระบบต่อท้ายเองเสมอ) */
  @IsOptional() @IsString() @MaxLength(2000, { message: 'ข้อความยาวเกิน 2000 ตัวอักษร' }) messageOverride?: string;
}

/**
 * เติมเบอร์/วันเกิดของลูกค้าจากขั้นที่ 1 ของใบยื่น (`PATCH /finance-applications/:id/customer-fields`)
 * ไม่ส่ง = ไม่แตะ · ส่ง null/ว่าง = ปฏิเสธ (รูปเดียวกับ UpdateCustomerDto — ห้ามล้างข้อมูลลูกค้าทางนี้)
 */
export class UpdateFinanceCustomerFieldsDto {
  @ValidateIf((o) => o.phone !== undefined)
  @Matches(/^0[0-9]{9}$/, { message: 'เบอร์โทรต้องเป็นเลข 10 หลัก ขึ้นต้นด้วย 0' })
  phone?: string;

  @ValidateIf((o) => o.birthDate !== undefined)
  @IsDateString({}, { message: 'วันเกิดไม่ถูกต้อง' })
  birthDate?: string;
}

export class StaffResultDto {
  @IsIn(['APPROVED', 'REJECTED', 'MORE_INFO'], { message: 'ผลต้องเป็น ผ่าน / ไม่ผ่าน / ขอเพิ่ม' })
  result: 'APPROVED' | 'REJECTED' | 'MORE_INFO';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class SendFinanceApplicationDto {
  @IsIn(['COPY', 'BOT'], { message: 'วิธีส่งไม่ถูกต้อง' }) via: 'COPY' | 'BOT';
}
