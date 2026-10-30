/**
 * Build browser-friendly URL that uses LINE Login OAuth.
 * Works outside LINE app — redirects through LINE Login → back to LIFF page.
 */
export function buildBrowserUrl(path: string): string {
  const apiBase = process.env.API_BASE_URL || 'http://localhost:3000';
  return `${apiBase}/api/line-oa/line-login/authorize?returnPath=${encodeURIComponent(path)}`;
}

/** หน้าที่ LINE Login พากลับเมื่อ returnPath ไม่มี/ไม่ปลอดภัย */
export const DEFAULT_LIFF_RETURN_PATH = '/liff/contract';
const MAX_RETURN_PATH_LENGTH = 2048;

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
  return raw;
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
