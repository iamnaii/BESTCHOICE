import type { CustomerDetail } from '../types';

export type CustomerKind = 'INSTALLMENT' | 'CASH' | 'PROSPECT';

/** นิยามเจ้าของ 2026-09-12: ลูกค้า = ซื้อแล้ว (ผ่อนกับเรา / เงินสด / ไฟแนนซ์นอก) ที่เหลือ = ผู้สนใจ */
export function customerKind(c: Pick<CustomerDetail, 'purchase'>): CustomerKind {
  const purchase = c.purchase;
  if (purchase && purchase.installmentTotal > 0) return 'INSTALLMENT';
  if (purchase && purchase.cashCount + purchase.externalFinanceCount > 0) return 'CASH';
  return 'PROSPECT';
}
