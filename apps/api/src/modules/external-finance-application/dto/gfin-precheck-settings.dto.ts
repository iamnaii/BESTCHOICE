import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PRECHECK_TEMPLATE_MAX_LENGTH } from '@installment/shared';

/** PUT /gfin-precheck-settings — ส่งเฉพาะช่องที่จะเปลี่ยน · null = ล้าง (ไม่ผูกกลุ่ม / กลับไปใช้แม่แบบในโค้ด) */
export class UpdateGfinPrecheckSettingsDto {
  @IsOptional() @IsString({ message: 'รหัสกลุ่มไม่ถูกต้อง' }) @MaxLength(64) lineGroupId?: string | null;
  @IsOptional() @IsString({ message: 'แม่แบบต้องเป็นข้อความ' }) @MaxLength(PRECHECK_TEMPLATE_MAX_LENGTH + 200, { message: 'แม่แบบยาวเกินไป' }) precheckTemplate?: string | null;
}
