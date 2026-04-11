/**
 * Centralized LIFF error messages
 *
 * Keep all user-facing Thai error strings in one place so:
 *  - Wording stays consistent across LIFF pages
 *  - Translations/copy edits happen in a single file
 *  - Duplicate strings don't drift out of sync
 *
 * Usage:
 *   import { LIFF_ERRORS } from '@/constants/liff-errors';
 *   throw new Error(LIFF_ERRORS.NOT_REGISTERED);
 */

export const LIFF_ERRORS = {
  // ─── Registration / Customer lookup ───────────────
  NOT_REGISTERED: 'ยังไม่ได้ลงทะเบียน กรุณาลงทะเบียนก่อน',
  CUSTOMER_NOT_FOUND: 'ไม่พบข้อมูลลูกค้า',
  REGISTER_FIRST: 'กรุณาลงทะเบียนก่อน',

  // ─── Load failures ────────────────────────────────
  LOAD_FAILED: 'ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่',
  DATA_NOT_FOUND: 'ไม่พบข้อมูล',

  // ─── Payment link ─────────────────────────────────
  LINK_INVALID: 'ลิงก์ไม่ถูกต้อง',
  LINK_EXPIRED: 'ลิงก์ชำระเงินหมดอายุแล้ว กรุณาขอลิงก์ใหม่',
  LINK_USED: 'ลิงก์นี้ถูกใช้งานแล้ว',
  PAYMENT_DATA_NOT_FOUND: 'ไม่พบข้อมูลการชำระเงิน',

  // ─── Contracts ────────────────────────────────────
  CONTRACT_ID_MISSING: 'ไม่พบรหัสสัญญา',
  CONTRACT_NOT_FOUND: 'ไม่พบข้อมูลสัญญา',

  // ─── Slip upload (client-side pre-validation) ─────
  SLIP_TOO_LARGE: 'ไฟล์ใหญ่เกินไป กรุณาเลือกรูปขนาดไม่เกิน 5MB',
  SLIP_WRONG_FORMAT: 'รูปแบบไฟล์ไม่รองรับ กรุณาใช้ JPG, PNG, WebP หรือ HEIC',
  SLIP_UPLOAD_TIMEOUT: 'เชื่อมต่ออินเทอร์เน็ตช้าหรือหลุด กรุณาลองใหม่',
  SLIP_UPLOAD_FAILED: 'อัปโหลดสลิปไม่สำเร็จ กรุณาลองใหม่',

  // ─── Gateway / Payment creation ───────────────────
  PAYMENT_CREATE_FAILED: 'ไม่สามารถสร้างรายการชำระเงินได้',
  PAYMENT_LINK_MISSING: 'ไม่ได้รับลิงก์ชำระเงิน กรุณาลองใหม่',
} as const;

// ─── Slip upload constraints (match backend validators) ──
// apps/api/src/modules/line-oa/line-oa-payment.controller.ts
export const SLIP_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const SLIP_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

/**
 * Validate a slip file client-side so we can surface specific Thai errors
 * before attempting the upload. Returns null if valid, or an error string
 * from LIFF_ERRORS when it fails.
 */
export function validateSlipFile(file: File): string | null {
  if (file.size > SLIP_MAX_SIZE_BYTES) {
    return LIFF_ERRORS.SLIP_TOO_LARGE;
  }
  // Some Android browsers report empty mime for HEIC — fall back to extension check
  const mime = file.type.toLowerCase();
  if (mime && !SLIP_ALLOWED_MIME_TYPES.includes(mime)) {
    return LIFF_ERRORS.SLIP_WRONG_FORMAT;
  }
  if (!mime) {
    const name = file.name.toLowerCase();
    const okExt = /\.(jpe?g|png|webp|heic|heif)$/i.test(name);
    if (!okExt) return LIFF_ERRORS.SLIP_WRONG_FORMAT;
  }
  return null;
}
