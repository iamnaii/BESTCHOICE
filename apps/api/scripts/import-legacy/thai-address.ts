/**
 * Thai address resolver
 * รับรหัส tambon 6 หลัก (มาตรฐาน TIS 1099) → คืนชื่อจังหวัด/อำเภอ/ตำบล
 *
 * Data source: https://github.com/kongvut/thai-province-data
 * (sub_district_with_district_and_province.json)
 */
import * as fs from 'fs';
import * as path from 'path';

interface RawTambon {
  id: number;
  zip_code: number;
  name_th: string;
  district: {
    id: number;
    name_th: string;
    province: {
      id: number;
      name_th: string;
    };
  };
}

let lookup: Map<number, RawTambon> | null = null;

function load(): Map<number, RawTambon> {
  if (lookup) return lookup;
  const file = path.resolve(__dirname, 'data/thai-tambon.json');
  if (!fs.existsSync(file)) {
    throw new Error(`Thai tambon data not found: ${file}`);
  }
  const arr: RawTambon[] = JSON.parse(fs.readFileSync(file, 'utf-8'));
  lookup = new Map();
  for (const t of arr) lookup.set(t.id, t);
  return lookup;
}

export interface ResolvedAddress {
  tambon: string | null;
  amphure: string | null;
  province: string | null;
  zipcode: string | null;
}

/**
 * Resolve รหัส tambon → ชื่อ
 * ถ้าหารหัสไม่เจอ → return null fields (ใช้ raw zipcode แทน)
 */
export function resolveTambon(tambonCode: string | null): ResolvedAddress {
  if (!tambonCode) return { tambon: null, amphure: null, province: null, zipcode: null };
  const id = parseInt(tambonCode, 10);
  if (isNaN(id)) return { tambon: null, amphure: null, province: null, zipcode: null };
  const t = load().get(id);
  if (!t) return { tambon: null, amphure: null, province: null, zipcode: null };
  return {
    tambon: t.name_th,
    amphure: t.district.name_th,
    province: t.district.province.name_th,
    zipcode: String(t.zip_code),
  };
}

/**
 * Format ที่อยู่เต็มจาก raw line + รหัสตำบล
 * ตัวอย่าง: "319/144 หมู่ 8 ต.นิคมสร้างตนเอง อ.เมืองลพบุรี จ.ลพบุรี 15000"
 */
export function formatFullAddress(addressLine: string | null, tambonCode: string | null, fallbackZip: string | null): string | null {
  const parts: string[] = [];
  if (addressLine && addressLine.trim()) parts.push(addressLine.trim());
  const r = resolveTambon(tambonCode);
  if (r.tambon) parts.push(`ต.${r.tambon}`);
  if (r.amphure) parts.push(`อ.${r.amphure}`);
  if (r.province) parts.push(`จ.${r.province}`);
  // ใช้ zip จาก lookup ก่อน (แม่นกว่า) ถ้าไม่มีค่อยใช้ของเก่า
  const zip = r.zipcode || fallbackZip;
  if (zip) parts.push(zip);
  return parts.length > 0 ? parts.join(' ') : null;
}
