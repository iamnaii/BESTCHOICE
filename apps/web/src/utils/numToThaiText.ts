// Convert a Thai-Baht numeric value to its Thai-spelled equivalent for use on
// official documents (ใบสำคัญจ่าย, ใบเสร็จ, 50 ทวิ).
// Examples:
//   4815       → "สี่พันแปดร้อยสิบห้าบาทถ้วน"
//   4815.50    → "สี่พันแปดร้อยสิบห้าบาทห้าสิบสตางค์"
//   1000000    → "หนึ่งล้านบาทถ้วน"
//
// Rules per ราชบัณฑิตยสภา + ราชกิจจาฯ standard:
//   - 1 in ten's place → "เอ็ด" (เช่น 21 = ยี่สิบเอ็ด)
//   - 2 in ten's place → "ยี่สิบ"
//   - 1 in ten's place when next-up digit > 0 in non-final position → "สิบ" (no "หนึ่ง")
//   - Numbers ≥ 1,000,000 break into groups of 6 digits joined by "ล้าน"

const DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

function readSixDigitGroup(n: number, isLastGroup: boolean): string {
  // n must be 0..999999. Render the group right-to-left.
  if (n === 0) return '';
  const digits = String(n).split('').reverse().map(Number);
  let out = '';
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = digits[i];
    if (d === 0) continue;
    if (i === 1) {
      // tens place
      if (d === 1) out += 'สิบ';
      else if (d === 2) out += 'ยี่สิบ';
      else out += DIGITS[d] + 'สิบ';
    } else if (i === 0) {
      // units place
      if (d === 1 && (digits[1] ?? 0) > 0 && !isLastGroup) {
        out += 'เอ็ด'; // mid-number — keep เอ็ด
      } else if (d === 1 && (digits[1] ?? 0) > 0) {
        out += 'เอ็ด'; // tens > 0 → เอ็ด (e.g. 21 = ยี่สิบเอ็ด)
      } else {
        out += DIGITS[d];
      }
    } else {
      out += DIGITS[d] + PLACES[i];
    }
  }
  return out;
}

export function numToThaiText(value: number | string): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return '';

  const abs = Math.abs(n);
  const baht = Math.floor(abs);
  const satang = Math.round((abs - baht) * 100);

  const sign = n < 0 ? 'ลบ' : '';

  // Split baht into groups of 6 digits (ล้าน boundary).
  let bahtPart = '';
  if (baht === 0) {
    bahtPart = 'ศูนย์';
  } else {
    const groups: number[] = [];
    let remain = baht;
    while (remain > 0) {
      groups.push(remain % 1_000_000);
      remain = Math.floor(remain / 1_000_000);
    }
    // groups[0] = units, groups[1] = ล้าน, groups[2] = ล้านล้าน, ...
    const parts: string[] = [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if (g === 0) continue;
      const isLastGroup = i === 0;
      parts.push(readSixDigitGroup(g, isLastGroup));
      if (i > 0) parts.push('ล้าน');
    }
    bahtPart = parts.join('');
  }

  const bahtText = `${sign}${bahtPart}บาท`;

  if (satang === 0) {
    return `${bahtText}ถ้วน`;
  }
  const satangText = readSixDigitGroup(satang, true) + 'สตางค์';
  return `${bahtText}${satangText}`;
}
