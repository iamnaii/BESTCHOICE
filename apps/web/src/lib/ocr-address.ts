import type { OcrAddressStructured, OcrResult } from '@/types/ocr';

/** Retain each form's existing handling of ต./อ./แขวง/เขต prefixes. */
export function parseOcrAddress(raw: string, keepAreaPrefixes: boolean): OcrAddressStructured {
  const addr: OcrAddressStructured = {
    houseNo: '',
    moo: '',
    village: '',
    soi: '',
    road: '',
    province: '',
    district: '',
    subdistrict: '',
    postalCode: '',
  };
  const zipMatch = raw.match(/(\d{5})\s*$/);
  if (zipMatch) addr.postalCode = zipMatch[1];
  const houseMatch = raw.match(/^(\d+(?:\/\d+)?)\s/);
  if (houseMatch) addr.houseNo = houseMatch[1];
  const mooMatch = raw.match(/(?:หมู่(?:ที่)?|ม\.)\s*(\d+)/);
  if (mooMatch) addr.moo = mooMatch[1];
  const soiMatch = raw.match(/(?:ซอย|ซ\.)\s*([^\s,]+)/);
  if (soiMatch) addr.soi = soiMatch[1];
  const roadMatch = raw.match(/(?:ถนน|ถ\.)\s*([^\s,]+)/);
  if (roadMatch) addr.road = roadMatch[1];
  const villageMatch = raw.match(/(?:หมู่บ้าน|ม\.บ\.|คอนโด)\s*([^\s,]+)/);
  if (villageMatch) addr.village = villageMatch[1];
  const subdistrictMatch = raw.match(
    keepAreaPrefixes ? /((?:ตำบล|ต\.|แขวง)\s*[^\s,]+)/ : /(?:ตำบล|ต\.|แขวง)\s*([^\s,]+)/,
  );
  if (subdistrictMatch) addr.subdistrict = subdistrictMatch[1];
  const districtMatch = raw.match(
    keepAreaPrefixes ? /((?:อำเภอ|อ\.|เขต)\s*[^\s,]+)/ : /(?:อำเภอ|อ\.|เขต)\s*([^\s,]+)/,
  );
  if (districtMatch) addr.district = districtMatch[1];
  const provinceMatch = raw.match(/(?:จังหวัด|จ\.)\s*([^\s,\d]+)/);
  if (provinceMatch) addr.province = provinceMatch[1];
  return addr;
}

export function serializeOcrAddress(
  data: Pick<OcrResult, 'address' | 'addressStructured'>,
  options: { keepAreaPrefixes: boolean; unparsed: 'raw' | 'json' },
): string | undefined {
  if (data.addressStructured && Object.values(data.addressStructured).some((v) => v !== '')) {
    return JSON.stringify(data.addressStructured);
  }
  if (!data.address) return undefined;
  const addr = parseOcrAddress(data.address, options.keepAreaPrefixes);
  if (Object.values(addr).some((v) => v !== '')) return JSON.stringify(addr);
  return options.unparsed === 'raw' ? data.address : JSON.stringify({ ...addr, raw: data.address });
}
