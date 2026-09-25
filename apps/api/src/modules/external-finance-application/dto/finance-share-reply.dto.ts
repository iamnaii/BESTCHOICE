import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const PARTNER_REPLY_ACTIONS = ['ACK', 'MORE_INFO', 'APPROVED', 'REJECTED'] as const;
export type PartnerReplyAction = (typeof PARTNER_REPLY_ACTIONS)[number];

/** spec §5.2: `{action, name (บังคับ ≤80), note (≤500)}` — ชื่อผู้ตอบไปโผล่ในไทม์ไลน์ของร้าน ("คุณเอ (GFIN)") */
export class FinanceShareReplyDto {
  @IsIn(PARTNER_REPLY_ACTIONS, { message: 'คำตอบไม่ถูกต้อง' })
  action!: PartnerReplyAction;

  // @MinLength(1) ยอมให้ "   " (ช่องว่างล้วน) ผ่านได้ — fix round 1 Minor 9: บังคับให้มีตัวอักษร
  // ที่ไม่ใช่ whitespace อย่างน้อยหนึ่งตัว (ชื่อนี้ไปโผล่ในไทม์ไลน์ของร้านตรงๆ)
  @IsString() @MinLength(1, { message: 'กรุณาใส่ชื่อผู้ตอบ' }) @MaxLength(80, { message: 'ชื่อยาวเกิน 80 ตัวอักษร' })
  @Matches(/\S/, { message: 'กรุณาใส่ชื่อผู้ตอบ' })
  name!: string;

  @IsOptional() @IsString() @MaxLength(500, { message: 'หมายเหตุยาวเกิน 500 ตัวอักษร' })
  note?: string;
}
