import { BadRequestException, Logger } from '@nestjs/common';
import { OcrAddressStructured } from '../dto/ocr.dto';

export const THAI_PROVINCES: readonly string[] = [
  'กรุงเทพมหานคร', 'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร',
  'ขอนแก่น', 'จันทบุรี', 'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท',
  'ชัยภูมิ', 'ชุมพร', 'เชียงราย', 'เชียงใหม่', 'ตรัง',
  'ตราด', 'ตาก', 'นครนายก', 'นครปฐม', 'นครพนม',
  'นครราชสีมา', 'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส',
  'น่าน', 'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์',
  'ปราจีนบุรี', 'ปัตตานี', 'พระนครศรีอยุธยา', 'พะเยา', 'พังงา',
  'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์',
  'แพร่', 'ภูเก็ต', 'มหาสารคาม', 'มุกดาหาร', 'แม่ฮ่องสอน',
  'ยโสธร', 'ยะลา', 'ร้อยเอ็ด', 'ระนอง', 'ระยอง',
  'ราชบุรี', 'ลพบุรี', 'ลำปาง', 'ลำพูน', 'เลย',
  'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ',
  'สมุทรสงคราม', 'สมุทรสาคร', 'สระแก้ว', 'สระบุรี', 'สิงห์บุรี',
  'สุโขทัย', 'สุพรรณบุรี', 'สุราษฎร์ธานี', 'สุรินทร์', 'หนองคาย',
  'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์',
  'อุทัยธานี', 'อุบลราชธานี',
];

export function validateNationalId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  const digits = id.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += digits[i] * (13 - i);
  }
  const checkDigit = (11 - (sum % 11)) % 10;
  return checkDigit === digits[12];
}

export function isValidDate(dateStr: string): boolean {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  return (
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
  );
}

export function validateImageBase64(imageBase64: string): { mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; base64Data: string } {
  if (!imageBase64.startsWith('data:')) {
    throw new BadRequestException('รูปแบบไฟล์ไม่ถูกต้อง กรุณาส่งเป็น base64 data URL');
  }

  const prefixMatch = imageBase64.match(/^data:(image\/(jpeg|png|gif|webp));base64,/);
  if (!prefixMatch) {
    throw new BadRequestException('รูปแบบรูปภาพไม่รองรับ กรุณาใช้ JPEG, PNG, GIF หรือ WebP');
  }

  const mediaType = prefixMatch[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  const base64Data = imageBase64.slice(prefixMatch[0].length);

  if (!/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
    throw new BadRequestException('ข้อมูลรูปภาพไม่ถูกต้อง (base64 ไม่ valid)');
  }

  return { mediaType, base64Data };
}

export function validateFileBase64(fileBase64: string): { mediaType: string; base64Data: string; isDocument: boolean } {
  if (!fileBase64.startsWith('data:')) {
    throw new BadRequestException('รูปแบบไฟล์ไม่ถูกต้อง กรุณาส่งเป็น base64 data URL');
  }

  const prefixMatch = fileBase64.match(/^data:(image\/(jpeg|png|gif|webp)|application\/pdf);base64,/);
  if (!prefixMatch) {
    throw new BadRequestException('รูปแบบไฟล์ไม่รองรับ กรุณาใช้ JPEG, PNG, WebP หรือ PDF');
  }

  const mediaType = prefixMatch[1];
  const base64Data = fileBase64.slice(prefixMatch[0].length);
  const isDocument = mediaType === 'application/pdf';

  if (!/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
    throw new BadRequestException('ข้อมูลไฟล์ไม่ถูกต้อง (รูปแบบ base64 ไม่ถูกต้อง)');
  }

  return { mediaType, base64Data, isDocument };
}

export function parseJsonResponse(rawText: string): unknown {
  let jsonText = rawText.trim();
  const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  }
  // Remove trailing commas before } or ]
  jsonText = jsonText.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(jsonText);
}

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function findClosestProvince(input: string, logger: Logger): string {
  // Strip common prefixes
  const cleaned = input.replace(/^(จังหวัด|จ\.|จ\s)/g, '').trim();
  if (!cleaned) return input;

  // Exact match
  if (THAI_PROVINCES.includes(cleaned)) return cleaned;

  // Fuzzy match
  let bestMatch = cleaned;
  let bestDistance = Infinity;
  const maxDistance = Math.max(2, Math.floor(cleaned.length * 0.3));

  for (const province of THAI_PROVINCES) {
    const distance = levenshteinDistance(cleaned, province);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = province;
    }
  }

  if (bestDistance <= maxDistance) {
    if (bestDistance > 0) {
      logger.log(`Province corrected: "${cleaned}" → "${bestMatch}" (distance: ${bestDistance})`);
    }
    return bestMatch;
  }

  return cleaned;
}

export function buildAddressStructured(raw: unknown, logger: Logger): OcrAddressStructured | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, string>;

  const rawSubdistrict = (a.subdistrict || '').trim();
  const rawDistrict = (a.district || '').trim();
  const rawProvince = (a.province || '').trim();

  const structured: OcrAddressStructured = {
    houseNo: (a.houseNo || '').trim(),
    moo: (a.moo || '').trim().replace(/^(หมู่ที่|หมู่|ม\.)\s*/g, ''),
    village: (a.village || '').trim(),
    soi: (a.soi || '').trim().replace(/^(ซอย|ซ\.)\s*/g, ''),
    road: (a.road || '').trim().replace(/^(ถนน|ถ\.)\s*/g, ''),
    subdistrict: rawSubdistrict,
    district: rawDistrict,
    province: rawProvince ? findClosestProvince(rawProvince, logger) : '',
    postalCode: /^\d{5}$/.test((a.postalCode || '').trim()) ? a.postalCode.trim() : '',
  };
  const hasData = Object.values(structured).some((v) => v !== '');
  return hasData ? structured : null;
}
