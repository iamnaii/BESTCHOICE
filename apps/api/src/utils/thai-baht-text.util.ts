const DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** Read a 1–6 digit group into Thai words (เอ็ด / สิบ / ยี่สิบ special cases). */
function readGroup(n: number): string {
  if (n === 0) return '';
  let s = '';
  const str = String(Math.floor(n));
  const len = str.length;
  for (let i = 0; i < len; i++) {
    const d = parseInt(str[i], 10);
    const place = len - i - 1;
    if (d === 0) continue;
    if (place === 1 && d === 1) s += 'สิบ';
    else if (place === 1 && d === 2) s += 'ยี่สิบ';
    else if (place === 0 && d === 1 && len > 1) s += 'เอ็ด';
    else s += DIGITS[d] + PLACES[place];
  }
  return s;
}

/**
 * Convert a baht amount to Thai words.
 *   1234.50 → "หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์"
 *   1000    → "หนึ่งพันบาทถ้วน"
 *
 * Canonical shared implementation. Replaces three near-duplicate copies that had
 * drifted: `voucher.service` (broke at ≥10,000,000 — its single-loop positions
 * array ran out at the ล้าน place), `letter-pdf.service` (no negative / non-finite
 * guards), and `receipt-pdf.service` (this robust version). Output is identical to
 * all three for normal amounts; it additionally handles negatives ("ลบ…"),
 * non-finite input, and caps below 1e12 (ล้านล้าน would need a different grouping).
 */
export function thaiBahtText(num: number): string {
  if (!isFinite(num)) return '(จำนวนเงินไม่ถูกต้อง)';
  if (num < 0) return `ลบ${thaiBahtText(-num)}`;
  if (num === 0) return 'ศูนย์บาทถ้วน';
  if (num >= 1e12) return '(จำนวนเงินเกินขีดจำกัด)';

  let text = '';
  let remaining = Math.floor(num);
  if (remaining >= 1_000_000) {
    const millions = Math.floor(remaining / 1_000_000);
    text += readGroup(millions) + 'ล้าน';
    remaining -= millions * 1_000_000;
  }
  if (remaining > 0) text += readGroup(remaining);
  text += 'บาท';

  const satang = Math.round((num - Math.floor(num)) * 100);
  if (satang === 0) text += 'ถ้วน';
  else text += readGroup(satang) + 'สตางค์';
  return text;
}
