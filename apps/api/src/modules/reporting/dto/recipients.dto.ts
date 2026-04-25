import { IsArray, IsEmail, ArrayMaxSize } from 'class-validator';

/**
 * Update recipient list for weekly PDF report email.
 * Stored in SystemConfig key `pdf_report_recipients` as comma-separated emails.
 */
export class UpdateRecipientsDto {
  @IsArray({ message: 'recipients ต้องเป็น array' })
  @ArrayMaxSize(20, { message: 'ระบุได้ไม่เกิน 20 ผู้รับ' })
  @IsEmail({}, { each: true, message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  recipients!: string[];
}
