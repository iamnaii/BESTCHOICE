/**
 * กติกาฝั่งหน้าจอของ "ช่องรับเงิน" — คู่กับ `normalizeTenders` ฝั่ง API (apps/api/src/modules/shop-tenders/shop-tender.util.ts)
 * ซึ่งเป็นผู้ตัดสินตัวจริง; ฝั่งนี้มีไว้ปิดปุ่มบันทึกและบอกผู้ใช้ก่อนยิงคำขอ.
 * เจ้าของเคาะ 2026-09-20: โอน/QR บังคับเลขอ้างอิง · บิลเดียวจ่ายผสมได้ สูงสุด 4 บรรทัด.
 */
export type TenderMethod = 'CASH' | 'BANK_TRANSFER' | 'QR_EWALLET';

export interface TenderRow {
  method: TenderMethod;
  /** ข้อความในช่องกรอก (ยังไม่แปลงเป็นตัวเลข) */
  amount: string;
  reference: string;
}

export interface TenderPayload {
  method: TenderMethod;
  amount: number;
  reference?: string;
}

export const MAX_TENDERS = 4;
export const MIN_REFERENCE_LENGTH = 6;
export const MAX_REFERENCE_LENGTH = 128;

export const TENDER_METHOD_OPTIONS: { value: TenderMethod; label: string }[] = [
  { value: 'CASH', label: 'เงินสด' },
  { value: 'BANK_TRANSFER', label: 'โอนธนาคาร' },
  { value: 'QR_EWALLET', label: 'QR / e-Wallet' },
];

export const tenderMethodLabel = (method: string): string =>
  TENDER_METHOD_OPTIONS.find((o) => o.value === method)?.label ?? method;

/** "เงินสด + โอนธนาคาร" — ใช้แสดงวิธีรับของบิลจ่ายผสมในรายการขาย */
export const tenderMethodsLabel = (methods: string[]): string =>
  [...new Set(methods)].map(tenderMethodLabel).join(' + ');

/** บาท → สตางค์ (จำนวนเต็ม) — เลี่ยงทศนิยมลอยตัวตอนรวมยอด */
export const toSatang = (value: string | number): number => {
  const n = typeof value === 'number' ? value : parseFloat(value.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export const fromSatang = (satang: number): string => (satang / 100).toFixed(2);

export const formatBaht = (satang: number): string =>
  (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const initialTenders = (due: number): TenderRow[] => [
  { method: 'CASH', amount: fromSatang(toSatang(due)), reference: '' },
];

export const needsReference = (method: TenderMethod): boolean => method !== 'CASH';

export const referenceOk = (row: TenderRow): boolean =>
  !needsReference(row.method) || row.reference.trim().length >= MIN_REFERENCE_LENGTH;

export interface TenderStatus {
  /** บันทึกได้: ยอดรวมเท่ายอดที่ต้องรับพอดี ทุกบรรทัด > 0 และโอน/QR มีเลขอ้างอิงครบ */
  ready: boolean;
  totalSatang: number;
  dueSatang: number;
  /** บวก = ยังขาด · ลบ = เกิน */
  diffSatang: number;
  missingReference: boolean;
  invalidAmount: boolean;
  label: string;
}

export function tenderStatus(rows: TenderRow[], due: number): TenderStatus {
  const dueSatang = Math.max(0, toSatang(due));
  if (dueSatang === 0) {
    return { ready: true, totalSatang: 0, dueSatang: 0, diffSatang: 0, missingReference: false, invalidAmount: false, label: 'ไม่มียอดที่ต้องรับ' };
  }
  const totalSatang = rows.reduce((sum, r) => sum + toSatang(r.amount), 0);
  const diffSatang = dueSatang - totalSatang;
  const invalidAmount = rows.some((r) => toSatang(r.amount) <= 0);
  const missingReference = rows.some((r) => !referenceOk(r));
  const label = invalidAmount
    ? 'จำนวนเงินต้องมากกว่า 0'
    : diffSatang > 0
      ? `ยังขาด ${formatBaht(diffSatang)}`
      : diffSatang < 0
        ? `เกิน ${formatBaht(-diffSatang)}`
        : missingReference
          ? 'ยังขาดเลขอ้างอิง'
          : 'รับครบแล้ว';
  return { ready: !invalidAmount && diffSatang === 0 && !missingReference, totalSatang, dueSatang, diffSatang, missingReference, invalidAmount, label };
}

/** ตัวที่ส่งให้ API — ยอดที่ต้องรับ = 0 ส่งอาร์เรย์ว่าง (API ปฏิเสธบรรทัดที่ส่งมากับยอด 0) */
export function toTenderPayload(rows: TenderRow[], due: number): TenderPayload[] {
  if (toSatang(due) <= 0) return [];
  return rows.map((r) => ({
    method: r.method,
    amount: toSatang(r.amount) / 100,
    ...(needsReference(r.method) ? { reference: r.reference.trim() } : {}),
  }));
}
