/**
 * T3-C9: Normalize a Thai mobile phone for application-level dedup (no DB `@unique`
 * — legacy duplicates exist). Strips spaces, dashes, parentheses, and an optional
 * +66 / 66 country prefix, always returning a leading zero. Examples:
 *   "081-234 5678"   → "0812345678"
 *   "+66812345678"   → "0812345678"
 *   "(081) 234 5678" → "0812345678"
 * กติกาเดียวของทั้งฝั่งพนักงาน (CustomerWriteService) และบอทขาย (capture_lead)
 * ข้อสังเกต: สตริงที่มีแต่ช่องว่าง/ขีด คืน '' (ไม่ใช่ null) — ผู้เรียกที่ต้องการ "ไม่มีเบอร์" ให้ใช้ `|| null`
 */
export function normalizeThaiPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.replace(/[\s()-]/g, '');
  if (trimmed.startsWith('+66')) return '0' + trimmed.slice(3);
  if (trimmed.startsWith('66') && trimmed.length === 11) return '0' + trimmed.slice(2);
  return trimmed;
}
