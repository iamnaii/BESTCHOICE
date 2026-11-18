/** งบทดลองแบบช่วงเวลา (ยอดยกมา / ระหว่างงวด / ยอดคงเหลือ) — ชนิดข้อมูลของ GET /expenses/ledger/trial-balance?periodStart= */

export const TB_AMOUNT_KEYS = ['openingDr', 'openingCr', 'periodDr', 'periodCr', 'closingDr', 'closingCr'] as const;
export type TbAmountKey = (typeof TB_AMOUNT_KEYS)[number];
export type PeriodTbAmounts = Record<TbAmountKey, string | number>;

export interface PeriodTbRow extends PeriodTbAmounts {
  code: string;
  name: string;
  type: string;
  normalBalance: string;
}

export interface PeriodTbSection {
  sectionName: string;
  codePrefix: string;
  rows: PeriodTbRow[];
  totals: PeriodTbAmounts;
}

export interface PeriodTbBalanced {
  opening: boolean;
  period: boolean;
  closing: boolean;
}

export interface PeriodTbData {
  periodStart: string;
  periodEnd: string;
  /** บริษัทที่งบนี้กรอง (ทั้งหมด = null) — ส่งต่อให้บัญชีแยกประเภทกรองตรงกัน */
  companyId?: string | null;
  sections: PeriodTbSection[];
  totals: PeriodTbAmounts;
  isBalanced: PeriodTbBalanced;
}

const toNumber = (value: string | number | null | undefined): number => {
  if (value == null) return 0;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isNaN(n) ? 0 : n;
};

/** ยอดเงิน 2 ตำแหน่ง · ศูนย์ = เว้นว่าง (แบบ PEAK) ยกเว้นแถวรวมที่ส่ง blankZero = false */
export function fmtAmount(value: string | number | null | undefined, blankZero = true): string {
  const n = toNumber(value);
  if (n === 0 && blankZero) return '';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const hasAnyAmount = (row: PeriodTbRow): boolean => TB_AMOUNT_KEYS.some((key) => toNumber(row[key]) !== 0);

/** ซ่อนบัญชีที่ไม่มียอดทั้ง 6 ช่อง (และหมวดที่ไม่เหลือบัญชี) — แถวรวมของหมวดไม่เปลี่ยน */
export function visibleSections(sections: PeriodTbSection[], hideZero: boolean): PeriodTbSection[] {
  if (!hideZero) return sections;
  return sections
    .map((section) => ({ ...section, rows: section.rows.filter(hasAnyAmount) }))
    .filter((section) => section.rows.length > 0);
}

/** ลิงก์ไปบัญชีแยกประเภทของบัญชีนั้น ช่วงวันที่และบริษัทเดียวกับงบทดลอง */
export function ledgerHref(code: string, startDate: string, endDate: string, companyId?: string | null): string {
  const params = new URLSearchParams({ account: code, start: startDate, end: endDate });
  if (companyId) params.set('company', companyId);
  params.set('from', 'trial-balance');
  return `/finance/general-ledger?${params}`;
}

/** รหัสที่มีรายการแต่ไม่อยู่ในผังบัญชี (type 'ไม่ระบุ') — บัญชีแยกประเภทตอบ 404 จึงไม่ทำเป็นลิงก์ */
export function canOpenLedger(row: PeriodTbRow): boolean {
  return row.type !== 'ไม่ระบุ';
}

/** ชื่อคู่คอลัมน์ที่เดบิตรวมไม่เท่าเครดิตรวม (ว่าง = สมดุลครบ) */
export function unbalancedLabels(balanced: PeriodTbBalanced): string[] {
  return [
    ...(balanced.opening ? [] : ['ยอดยกมา']),
    ...(balanced.period ? [] : ['ระหว่างงวด']),
    ...(balanced.closing ? [] : ['ยอดคงเหลือ']),
  ];
}
