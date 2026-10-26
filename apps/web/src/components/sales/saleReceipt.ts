/**
 * ใบเสร็จขายสด (ก้อน 4 · 2026-10-23) — ข้อความและ path ที่ POS dialog กับแผงใบขายใช้ร่วมกัน
 */

export type SaleReceiptLineResult = { delivered: boolean; reason?: string };

export const RECEIPT_SALE_TYPES = ['CASH', 'EXTERNAL_FINANCE'] as const;

export function hasSaleReceipt(saleType: string): boolean {
  return (RECEIPT_SALE_TYPES as readonly string[]).includes(saleType);
}

export function receiptPdfPath(saleId: string): string {
  return `/sales/${saleId}/receipt.pdf`;
}

export function receiptFilename(saleNumber: string): string {
  return `ใบเสร็จ-${saleNumber}.pdf`;
}

/** ผลจาก POST /sales/:id/receipt/line → ข้อความบอกทางออกที่ทำได้จริง (คัดลอกลิงก์มีอยู่ข้างปุ่มเดียวกัน) */
export function lineResultMessage(r: SaleReceiptLineResult): { kind: 'success' | 'error'; text: string } {
  if (r.delivered) return { kind: 'success', text: 'ส่งใบเสร็จทาง LINE แล้ว' };
  if (r.reason === 'NO_LINE_LINK') return { kind: 'error', text: 'ลูกค้ายังไม่ผูก LINE ร้าน — คัดลอกลิงก์ส่งให้แทน' };
  return { kind: 'error', text: 'ส่ง LINE ไม่สำเร็จ ลองใหม่หรือคัดลอกลิงก์' };
}

/** วันที่ไทย dd/MM/พ.ศ. (เวลาไทย) สำหรับบอกวันหมดอายุลิงก์ */
export function thaiDateShort(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${Number(get('year')) + 543}`;
}
