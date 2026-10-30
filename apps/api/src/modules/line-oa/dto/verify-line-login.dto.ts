import { IsString, Matches, MaxLength } from 'class-validator';
import { LINE_LOGIN_NONCE_PATTERN } from '../../../utils/line-login.util';

/**
 * Task 21 I-A — หน้าเว็บส่ง id_token ที่มากับ URL (`#id_token=` จาก LINE Login callback) พร้อม nonce ของแท็บ
 * ที่เริ่มล็อกอิน (sessionStorage) มาให้ API ยืนยันกับ LINE ก่อนใช้ token นั้นเป็นตัวตน
 */
export class VerifyLineLoginDto {
  @IsString({ message: 'กรุณาระบุ id_token' })
  @MaxLength(4096, { message: 'id_token ไม่ถูกต้อง' })
  @Matches(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/, { message: 'id_token ไม่ถูกต้อง' })
  idToken!: string;

  @IsString({ message: 'กรุณาระบุ nonce' })
  @Matches(LINE_LOGIN_NONCE_PATTERN, { message: 'nonce ไม่ถูกต้อง' })
  nonce!: string;
}
