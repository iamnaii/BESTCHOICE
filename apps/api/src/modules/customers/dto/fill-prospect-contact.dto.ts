import { IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

/**
 * เติมเบอร์/ข้อมูลให้ "ผู้สนใจอัตโนมัติจากแชท" (สเปค 3.6 ปุ่ม "เพิ่มเบอร์/ข้อมูล", Ruling R27)
 * ใช้กับแถวที่ยังเป็น placeholder เท่านั้น — คนที่มีเบอร์แล้วต้องไป PATCH /customers/:id (OWNER/BM)
 * เบอร์บังคับ · ชื่อแก้ได้ · เลขบัตรไม่บังคับ (เติมตอนทำสัญญาก็ได้ — mockup บอร์ด 3)
 */
export class FillProspectContactDto {
  @Matches(/^0[0-9]{9}$/, { message: 'เบอร์โทรต้องเป็นเลข 10 หลัก ขึ้นต้นด้วย 0' })
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'ชื่อยาวเกินไป' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'คำนำหน้ายาวเกินไป' })
  prefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'ชื่อเล่นยาวเกินไป' })
  nickname?: string;

  // ไม่ส่ง = ไม่แตะ · ส่งค่าว่างไม่ได้ (ValidateIf ตรวจเมื่อมีค่าเท่านั้น — เหมือน CreateCustomerDto)
  // Fix round 1 (Ruling R34, Finding 1 Minor) — Matches แทน Length: Length(13,13) ยอมรับ
  // ตัวอักษรใดก็ได้ 13 ตัว (เช่น 'abc-def-ghi-jk') ส่วน Matches บังคับเป็นเลขล้วน 13 หลักจริง ๆ
  @IsOptional()
  @ValidateIf((o) => !!o.nationalId)
  @IsString()
  @Matches(/^\d{13}$/, { message: 'เลขบัตรประชาชนต้อง 13 หลัก' })
  nationalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'ชื่อ Facebook ยาวเกินไป' })
  facebookName?: string;
}
