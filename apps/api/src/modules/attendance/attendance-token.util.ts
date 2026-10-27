import { createHash, randomBytes, randomInt } from 'crypto';

/**
 * token/รหัสของเครื่องตอกบัตร (ก้อน 10 D3 · สเปก §4.1, §4.3)
 * - device token: สุ่ม 32 ไบต์ → base64url 43 ตัว · เก็บเฉพาะ sha256 (auth.service มี hashToken ของตัวเองแต่เป็น private)
 * - รหัสลงทะเบียน 8 ตัว จากตัวอักษรที่ไม่สับสน (ไม่มี 0/O 1/I/L) · อายุ 10 นาที ใช้ครั้งเดียว
 */
export const REGISTRATION_TTL_MS = 10 * 60_000;
export const REQUEST_CACHE_TTL_MS = 5 * 60_000;
export const PIN_LOCK_THRESHOLD = 5;
export const PIN_LOCK_MS = 15 * 60_000;
export const REGISTRATION_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REGISTRATION_CODE_LENGTH = 8;

export function newRawToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function newRegistrationCode(): string {
  let out = '';
  for (let i = 0; i < REGISTRATION_CODE_LENGTH; i++) out += REGISTRATION_CODE_ALPHABET[randomInt(REGISTRATION_CODE_ALPHABET.length)];
  return out;
}

/** รหัสที่ผู้ใช้พิมพ์: ตัดช่องว่าง/ขีด ตัวพิมพ์ใหญ่ · แก้ตัวที่สับสนให้ (0→O? ไม่ — alphabet ไม่มี O จึงแปลง O→0 ไม่ได้) เลยรับเฉพาะตัวใน alphabet */
export function normalizeRegistrationCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}
