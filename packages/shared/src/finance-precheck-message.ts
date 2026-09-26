/**
 * ข้อความ 12 ข้อที่ร้านส่งเข้ากลุ่มไลน์ GFIN ก่อนกรอกฟอร์มเว็บ (spec 2026-09-24 §7)
 * ถ้อยคำเดิมของทีม — ข้อ 8–12 เป็น "-" เสมอ (คำตัดสินเจ้าของ D4)
 */
export const DEFAULT_PRECHECK_TEMPLATE = `รายละเอียดที่ต้องแจ้งเช็คค่ะ
1.ชื่อลูกค้า : {{customerName}}
2.ทำอาชีพ : {{occupation}}
3.สนใจโทรศัพท์รุ่น : {{model}}
4.มือ1/2 : {{hand}}
5.เลขอีมี่ : {{imei}}
6.เบอร์ลูกค้า : {{phone}}
7.อายุ : {{age}} ปี
8.แบตเปลี่ยนมาหรือไม่? : -
9.แบตแท้หรือไม่แท้? : -
10.ลูกค้าทราบเรื่องแบตแล้วใช่ไหม? : -
11.มีกล่องหรือไม่? : -
12.มีสายชาร์จหรือไม่? : -
ส่งโดย {{staffName}} · BESTCHOICE
เอกสารทั้งหมด {{fileCount}} ไฟล์: {{link}}`;

export type PrecheckField = 'customerName' | 'occupation' | 'model' | 'hand' | 'imei' | 'phone' | 'age';
/** ลำดับตามข้อ 1–7 ของแม่แบบ — ใช้ทั้งรายงานช่องที่ขาดและเรียงข้อความเตือน */
export const PRECHECK_FIELDS: PrecheckField[] = ['customerName', 'occupation', 'model', 'hand', 'imei', 'phone', 'age'];
export const PRECHECK_FIELD_LABELS: Record<PrecheckField, string> = {
  customerName: 'ชื่อลูกค้า', occupation: 'อาชีพ', model: 'รุ่น', hand: 'มือ 1/2', imei: 'IMEI', phone: 'เบอร์ลูกค้า', age: 'อายุ (จากวันเกิด)',
};

export interface PrecheckValues {
  customerName: string | null;
  occupation: string | null;
  model: string | null;
  hand: '1' | '2' | null;
  imei: string | null;
  phone: string | null;       // ดิบ — จะถูกจัดรูป 0XX XXX XXXX ตอน render
  age: number | null;
  staffName: string | null;
  fileCount: number;
  link: string | null;
}

export function precheckMissingFields(values: PrecheckValues): PrecheckField[] {
  return PRECHECK_FIELDS.filter((field) => {
    const value = values[field];
    return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
  });
}

/** แทนที่ {{key}} ด้วยค่า — คีย์ที่ไม่รู้จักคงไว้ (ให้ผู้ตั้งค่าเห็นว่าพิมพ์ผิด) · ค่า null → ว่าง */
export function buildPrecheckMessage(template: string, values: PrecheckValues): string {
  const rendered: Record<string, string> = {
    customerName: values.customerName ?? '',
    occupation: values.occupation ?? '',
    model: values.model ?? '',
    hand: values.hand ?? '',
    imei: values.imei ?? '',
    phone: formatThaiMobile(values.phone),
    age: values.age === null || values.age === undefined ? '' : String(values.age),
    staffName: values.staffName ?? '',
    fileCount: String(values.fileCount),
    link: values.link ?? '',
  };
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => (key in rendered ? rendered[key] : whole));
}

/** อายุเต็มปี ณ วันที่ `at` (ค่าเริ่มต้น = วันนี้) — วันเกิดอ่านไม่ได้ → null */
export function computeAgeYears(birthDate: string | Date | null | undefined, at: Date = new Date()): number | null {
  if (!birthDate) return null;
  const born = birthDate instanceof Date ? birthDate : new Date(birthDate);
  if (Number.isNaN(born.getTime())) return null;
  let age = at.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    at.getUTCMonth() < born.getUTCMonth() ||
    (at.getUTCMonth() === born.getUTCMonth() && at.getUTCDate() < born.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age < 0 ? null : age;
}

/** 0937581095 / +66937581095 → "093 758 1095" · รูปแบบอื่นคืนค่าเดิม (ตัดช่องว่าง) */
export function formatThaiMobile(raw: string | null | undefined): string {
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('66') && digits.length === 11) digits = `0${digits.slice(2)}`;
  if (!/^0\d{9}$/.test(digits)) return raw.trim();
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

/** มือ 1/2 จากหมวดสินค้า — PHONE_USED = 2 นอกนั้น 1 (spec §7) */
export function renderHand(category: string | null | undefined): '1' | '2' {
  return category === 'PHONE_USED' ? '2' : '1';
}

/** ตัวแปรที่แม่แบบใช้ได้ — ต้องตรงกับคีย์ใน buildPrecheckMessage ทุกตัว */
export const PRECHECK_TEMPLATE_PLACEHOLDERS = ['customerName', 'occupation', 'model', 'hand', 'imei', 'phone', 'age', 'staffName', 'fileCount', 'link'] as const;
/** LINE รับข้อความ 5,000 ตัวอักษร — กันที่ 4,000 เผื่อค่าจริงที่ยาวกว่าตัวแปร (ชื่อรุ่นเต็ม ลิงก์ 80+ ตัว) */
export const PRECHECK_TEMPLATE_MAX_LENGTH = 4000;
export type PrecheckTemplateError = 'EMPTY' | 'TOO_LONG' | 'MISSING_LINK' | 'UNKNOWN_PLACEHOLDER';
export const PRECHECK_TEMPLATE_ERROR_LABEL: Record<PrecheckTemplateError, string> = {
  EMPTY: 'แม่แบบว่าง',
  TOO_LONG: `แม่แบบยาวเกิน ${PRECHECK_TEMPLATE_MAX_LENGTH} ตัวอักษร`,
  MISSING_LINK: 'ต้องมี {{link}} เพื่อวางลิงก์ชุดเอกสาร',
  UNKNOWN_PLACEHOLDER: 'มีตัวแปรที่ระบบไม่รู้จัก',
};

/** ตรวจแม่แบบก่อนบันทึก (spec §17 "แม่แบบถูกแก้จนไม่มี {{link}}") — errors ว่าง = ผ่าน · unknown = ชื่อตัวแปรที่ผิด (ไม่ซ้ำ) */
export function validatePrecheckTemplate(template: string): { errors: PrecheckTemplateError[]; unknown: string[] } {
  const t = template.trim();
  const errors: PrecheckTemplateError[] = [];
  if (!t) errors.push('EMPTY');
  if (t.length > PRECHECK_TEMPLATE_MAX_LENGTH) errors.push('TOO_LONG');
  if (!/\{\{link\}\}/.test(t)) errors.push('MISSING_LINK');
  const known: readonly string[] = PRECHECK_TEMPLATE_PLACEHOLDERS;
  const unknown = [...new Set([...t.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).filter((k) => !known.includes(k)))];
  if (unknown.length) errors.push('UNKNOWN_PLACEHOLDER');
  return { errors, unknown };
}
