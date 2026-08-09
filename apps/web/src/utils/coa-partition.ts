/**
 * ผังบัญชี 2 ฝั่งในตารางเดียว (P3-SP5): SHOP ใช้ prefix `S` (S11-XXXX) เป็น
 * partition key, FINANCE เป็นตัวเลขล้วน (11-XXXX). Helpers นี้ให้หน้า
 * ChartOfAccountsPage แยกฝั่ง/จัดหมวดถูกต้อง (เดิมตัด 2 ตัวอักษรแรกตรงๆ ทำให้
 * S52-1201 กลายเป็นหมวด "S5" — บั๊กแสดงผล 2026-08-07 design doc).
 */

export type CoaScope = 'FINANCE' | 'SHOP';

export function coaScopeOf(code: string): CoaScope {
  return code.startsWith('S') ? 'SHOP' : 'FINANCE';
}

/** "11-1101" → "11" · "S52-1201" → "S52" */
export function coaCodePrefix(code: string): string {
  return code.startsWith('S') ? code.slice(0, 3) : code.slice(0, 2);
}

// FINANCE — ตรงกับโครง finance-coa.csv (เดิมของหน้า)
const FINANCE_SECTION_LABELS: Record<string, string> = {
  '11': 'สินทรัพย์หมุนเวียน',
  '12': 'สินทรัพย์ไม่หมุนเวียน',
  '21': 'หนี้สินหมุนเวียน',
  '22': 'หนี้สินไม่หมุนเวียน',
  '31': 'ทุนเรือนหุ้น / ส่วนของเจ้าของ',
  '32': 'กำไรสะสม',
  '33': 'กำไรประจำปี',
  '39': 'บัญชีปิดงบ (Closing Accounts)',
  '41': 'รายได้จากการขาย',
  '42': 'รายได้อื่น',
  '51': 'ต้นทุนขาย',
  '52': 'ค่าใช้จ่ายในการขาย',
  '53': 'ค่าใช้จ่ายในการบริหาร',
  '54': 'ค่าใช้จ่ายทางการเงิน',
  '55': 'ค่าใช้จ่ายอื่น',
};

// SHOP — ตามกลุ่มใน shop-coa.csv (สอดคล้อง SECTION_MAP ฝั่งรายงาน API ที่ต่อท้าย "(SHOP)")
const SHOP_SECTION_LABELS: Record<string, string> = {
  S11: 'สินทรัพย์หมุนเวียน (SHOP)',
  S12: 'สินทรัพย์ไม่หมุนเวียน (SHOP)',
  S21: 'หนี้สินหมุนเวียน (SHOP)',
  S22: 'หนี้สินไม่หมุนเวียน (SHOP)',
  S31: 'ทุน (SHOP)',
  S32: 'กำไรสะสม (SHOP)',
  S33: 'กำไรประจำปี (SHOP)',
  S41: 'รายได้จากการขาย (SHOP)',
  S42: 'รายได้บริการ (SHOP)',
  S50: 'ต้นทุนขาย (SHOP)',
  S51: 'ค่าใช้จ่ายในการขาย (SHOP)',
  S52: 'ค่าใช้จ่ายบริหารสาขา (SHOP)',
  S53: 'ค่าใช้จ่ายอื่น (SHOP)',
};

export function coaSectionLabel(prefix: string): string {
  return (
    FINANCE_SECTION_LABELS[prefix] ?? SHOP_SECTION_LABELS[prefix] ?? `หมวด ${prefix}`
  );
}

/**
 * ตรวจรหัสบัญชีใหม่ให้ตรงฝั่งของแท็บที่เปิดอยู่ (กันสร้างบัญชีหลงผังแบบ 42-1199).
 * คืน error message ภาษาไทย หรือ null เมื่อผ่าน.
 */
export function validateCoaCodeForScope(code: string, scope: CoaScope): string | null {
  const trimmed = code.trim();
  const shopForm = /^S\d{2}-\d{4}$/.test(trimmed);
  const financeForm = /^\d{2}-\d{4}$/.test(trimmed);
  if (scope === 'SHOP') {
    if (!shopForm) {
      return 'ผังหน้าร้าน (SHOP) รหัสต้องขึ้นต้นด้วย S รูปแบบ SXX-XXXX เช่น S11-1101 — ถ้าต้องการเพิ่มบัญชีฝั่ง FINANCE ให้สลับแท็บก่อน';
    }
  } else if (!financeForm) {
    return 'ผัง FINANCE รหัสต้องเป็นรูปแบบ XX-XXXX เช่น 11-1101 — ถ้าต้องการเพิ่มบัญชีหน้าร้าน (S...) ให้สลับแท็บ SHOP ก่อน';
  }
  return null;
}
