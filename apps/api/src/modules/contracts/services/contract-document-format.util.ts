// Stateless formatting/escaping helpers extracted VERBATIM from DocumentsService
// during the Template/Signature/Rendering/Persistence decomposition. Pure functions
// — no dependency on Prisma/Storage/Settings/Notifications. fileUrlToBase64DataUrl
// (which needs storageService) intentionally stays on DocumentRenderingService.

/** Escape HTML special characters to prevent XSS */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Parse JSON address string and format as readable Thai address */
export function formatAddress(jsonStr: string | null | undefined): string {
  if (!jsonStr) return '-';
  try {
    const addr = JSON.parse(jsonStr);
    if (typeof addr !== 'object' || addr === null) return jsonStr;
    // If it has a raw field (fallback from OCR), use it
    if (addr.raw && !addr.province) return addr.raw;
    const parts: string[] = [];
    if (addr.houseNo) parts.push(addr.houseNo);
    if (addr.moo) parts.push(`หมู่ ${addr.moo}`);
    if (addr.village) parts.push(`หมู่บ้าน ${addr.village}`);
    if (addr.soi) parts.push(`ซอย ${addr.soi}`);
    if (addr.road) parts.push(`ถนน ${addr.road}`);
    if (addr.subdistrict) parts.push(addr.subdistrict);
    if (addr.district) parts.push(addr.district);
    if (addr.province) parts.push(addr.province);
    if (addr.postalCode) parts.push(addr.postalCode);
    return parts.length > 0 ? parts.join(' ') : '-';
  } catch {
    return jsonStr;
  }
}

/** Mask national ID: show first 1 and last 4 digits only */
export function maskNationalId(id: string): string {
  if (!id || id.length < 5) return id;
  return id[0] + '-xxxx-xxxxx-' + id.slice(-4);
}

/** Convert number to Thai baht text */
export function numberToThaiText(num: number): string {
  const digits = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const positions = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

  const convertIntPart = (n: number): string => {
    if (n === 0) return 'ศูนย์';
    let result = '';
    const str = String(n);
    const len = str.length;
    for (let i = 0; i < len; i++) {
      const d = Number(str[i]);
      const pos = len - i - 1;
      if (d === 0) continue;
      if (pos === 0 && d === 1 && len > 1) {
        result += 'เอ็ด';
      } else if (pos === 1 && d === 1) {
        result += 'สิบ';
      } else if (pos === 1 && d === 2) {
        result += 'ยี่สิบ';
      } else {
        result += digits[d] + positions[pos];
      }
    }
    return result;
  };

  const intPart = Math.floor(Math.abs(num));
  const decPart = Math.round((Math.abs(num) - intPart) * 100);

  let text = convertIntPart(intPart) + 'บาท';
  if (decPart > 0) {
    text += convertIntPart(decPart) + 'สตางค์';
  } else {
    text += 'ถ้วน';
  }
  return text;
}

/** Convert number to Thai text (no currency) */
export function numberToThaiCountText(num: number): string {
  const digits = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า', 'สิบ', 'สิบเอ็ด', 'สิบสอง'];
  if (num >= 0 && num <= 12) return digits[num];
  return String(num);
}

/** Validate that a data URL is a safe image format */
export function isSafeImageDataUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  // Check prefix is a valid image data URL, and ensure no HTML/script injection
  return /^data:image\/(png|jpeg|gif|webp);base64,/.test(url) && !/<|>|javascript:/i.test(url);
}
