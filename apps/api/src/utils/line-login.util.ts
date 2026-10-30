import { timingSafeEqual } from 'crypto';

/**
 * ลิงก์หน้า LIFF ที่บอทส่งให้ลูกค้า — เปิดได้ทั้งในแอป LINE และเบราว์เซอร์ทั่วไป.
 *
 * Task 21 I-A: ชี้ **หน้าเว็บ** (ไม่ใช่ `line-login/authorize` ของ API ตรง ๆ) — หน้าเว็บ (`useLiffInit`) เป็นคนเริ่ม
 * LINE Login พร้อม nonce ของแท็บเอง. ลิงก์เดิมที่ชี้ authorize ตรง ๆ (ยังค้างในประวัติแชท) ยังใช้ได้: token ที่ได้ไม่มี
 * nonce ของแท็บ ⇒ หน้าเว็บไม่รับ แล้วเริ่มล็อกอินใหม่หนึ่งรอบ (ในแอป LINE เป็นการล็อกอินอัตโนมัติเงียบ ๆ)
 */
export function buildBrowserUrl(path: string): string {
  try {
    return buildFrontendReturnUrl(primaryFrontendUrl(process.env.FRONTEND_URL), path).toString();
  } catch {
    // FRONTEND_URL ใช้ไม่ได้ — ถอยไปลิงก์ authorize เดิม (หน้าเว็บยังรับ token เฉพาะที่ nonce ตรงเหมือนเดิม)
    const apiBase = process.env.API_BASE_URL || 'http://localhost:3000';
    return `${apiBase}/api/line-oa/line-login/authorize?returnPath=${encodeURIComponent(path)}`;
  }
}

/**
 * Task 21 I-A — nonce ของ OIDC ที่หน้าเว็บสุ่มต่อแท็บ (base64url 32 ไบต์ = 43 ตัว) · รับช่วงกว้างพอสำหรับรูปแบบอื่น
 * แต่ไม่ยอมอักขระที่ต้อง encode (ส่งต่อใน URL ของ LINE ตรง ๆ)
 */
export const LINE_LOGIN_NONCE_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

/** nonce ที่รูปแบบถูกต้อง หรือ undefined (ไม่ใช่ string / array จาก query ซ้ำ / รูปแบบผิด) */
export function sanitizeLoginNonce(raw: unknown): string | undefined {
  return typeof raw === 'string' && LINE_LOGIN_NONCE_PATTERN.test(raw) ? raw : undefined;
}

/** เทียบ nonce แบบเวลาคงที่ (ความยาวต่างกัน = ไม่ตรง) */
export function loginNonceMatches(expected: string, actual: unknown): boolean {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** หน้าที่ LINE Login พากลับเมื่อ returnPath ไม่มี/ไม่ปลอดภัย */
export const DEFAULT_LIFF_RETURN_PATH = '/liff/contract';
const MAX_RETURN_PATH_LENGTH = 2048;
/** หน้าที่ LINE Login พากลับได้ — หน้า LIFF ทั้งหมดและหน้าชำระผ่านลิงก์ (`/pay/:token`) */
const RETURN_PATH_ALLOWLIST = /^\/(liff|pay)(\/|$)/;

/**
 * Task 20 C2 — returnPath ของ LINE Login ต้องเป็น path สัมพัทธ์บนโดเมนเว็บเท่านั้น.
 * callback แนบ `#id_token=` ของผู้ใช้ไปกับ URL ปลายทาง ⇒ ถ้าปลายทางออกนอกโดเมนได้ = ขโมย token.
 *
 * ปฏิเสธ (ใช้ค่าตั้งต้นแทน): ไม่ขึ้นต้นด้วย `/` (รวม `@host`, `.host`, `https:`, `javascript:`) ·
 * `//` หรือ `/\` (protocol-relative) · `\` ที่ใดก็ได้ (parser ของเบราว์เซอร์ถือเป็น `/`) ·
 * อักขระควบคุม/ช่องว่าง (parser ตัด tab/newline ทิ้ง ⇒ `/\t/evil` กลายเป็น `//evil`).
 */
export function sanitizeReturnPath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_RETURN_PATH_LENGTH) {
    return DEFAULT_LIFF_RETURN_PATH;
  }
  if (raw[0] !== '/' || raw[1] === '/' || raw[1] === '\\') return DEFAULT_LIFF_RETURN_PATH;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    // อักขระควบคุม + ช่องว่าง (≤ 0x20) · DEL · backslash
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return DEFAULT_LIFF_RETURN_PATH;
  }
  // fix round 1 M2: ตัดสินบน path ที่ normalize แล้ว (dot-segment) — `/..//evil` → `//evil` ·
  // รับเฉพาะหน้าที่ใช้ LINE Login จริง (`useLiffInit`: `/liff/*` และ `/pay/:token`) ไม่ใช่ทุก path ของโดเมน
  // (เช่น `/api/*` ที่ hosting rewrite ไป API) · คืนรูปที่ normalize แล้ว ⇒ ปลายทางตรงกับที่ตรวจ
  const normalized = new URL(raw, 'https://return-path.invalid');
  if (normalized.pathname.startsWith('//') || !RETURN_PATH_ALLOWLIST.test(normalized.pathname)) {
    return DEFAULT_LIFF_RETURN_PATH;
  }
  return `${normalized.pathname}${normalized.search}${normalized.hash}`;
}

/**
 * สร้าง URL ปลายทางบนเว็บจาก returnPath ด้วย `new URL(path, base)` (ไม่ต่อสตริง) แล้วยืนยันว่า
 * origin ตรงกับ FRONTEND_URL — ชั้นที่สองกันกรณีที่ sanitize มองข้าม
 */
export function buildFrontendReturnUrl(frontendBaseUrl: string, rawReturnPath: unknown): URL {
  const base = new URL(frontendBaseUrl);
  const url = new URL(sanitizeReturnPath(rawReturnPath), base);
  if (url.origin !== base.origin) return new URL(DEFAULT_LIFF_RETURN_PATH, base);
  return url;
}

/**
 * fix round 1 M3: FRONTEND_URL บน prod เป็นรายการ origin คั่น comma ได้ (ชุดเดียวกับ CORS ใน app.setup.ts) —
 * ปลายทางของ LINE Login ใช้ค่าแรก (แบบเดียวกับ staff-notify)
 */
export function primaryFrontendUrl(raw: string | undefined): string {
  return (raw || 'http://localhost:5173').split(',')[0].trim();
}
