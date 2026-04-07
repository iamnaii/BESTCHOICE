/**
 * Thai address resolver — รับรหัส tambon 6 หลัก (TIS 1099) → ชื่อจังหวัด/อำเภอ/ตำบล
 * Data file path resolved from LEGACY_DATA_DIR env var or fallback paths.
 */
import * as fs from 'fs';
import * as path from 'path';

interface RawTambon {
  id: number;
  zip_code: number;
  name_th: string;
  district: { id: number; name_th: string; province: { id: number; name_th: string } };
}

let lookup: Map<number, RawTambon> | null = null;

function load(): Map<number, RawTambon> {
  if (lookup) return lookup;

  // Try multiple paths to find thai-tambon.json
  const candidates = [
    process.env.LEGACY_TAMBON_FILE,
    path.resolve(process.cwd(), 'apps/api/scripts/import-legacy/data/thai-tambon.json'),
    path.resolve(process.cwd(), 'scripts/import-legacy/data/thai-tambon.json'),
    path.resolve(__dirname, '../../../../scripts/import-legacy/data/thai-tambon.json'),
    path.resolve(__dirname, '../../../../../scripts/import-legacy/data/thai-tambon.json'),
    '/app/apps/api/scripts/import-legacy/data/thai-tambon.json',
  ].filter(Boolean) as string[];

  let file: string | null = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      file = c;
      break;
    }
  }
  if (!file) {
    throw new Error(`thai-tambon.json not found. Tried: ${candidates.join(', ')}`);
  }

  const arr: RawTambon[] = JSON.parse(fs.readFileSync(file, 'utf-8'));
  lookup = new Map();
  for (const t of arr) lookup.set(t.id, t);
  return lookup;
}

export function formatFullAddress(addressLine: string | null, tambonCode: string | null, fallbackZip: string | null): string | null {
  const parts: string[] = [];
  if (addressLine && addressLine.trim()) parts.push(addressLine.trim());

  if (tambonCode) {
    const id = parseInt(tambonCode, 10);
    if (!isNaN(id)) {
      const t = load().get(id);
      if (t) {
        parts.push(`ต.${t.name_th}`);
        parts.push(`อ.${t.district.name_th}`);
        parts.push(`จ.${t.district.province.name_th}`);
        parts.push(String(t.zip_code));
        return parts.join(' ');
      }
    }
  }

  if (fallbackZip) parts.push(fallbackZip);
  return parts.length > 0 ? parts.join(' ') : null;
}
