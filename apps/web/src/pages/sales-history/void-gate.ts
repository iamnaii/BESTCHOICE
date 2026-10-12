const VOIDABLE_SALE_TYPES = new Set(['CASH', 'EXTERNAL_FINANCE']);

export type VoidGate =
  | { kind: 'button' }
  | { kind: 'text'; text: string; title: string }
  | { kind: 'none' };

/** mirror ของด่าน D1 + G9 ฝั่ง API (`SaleVoidService`) — ปุ่มโชว์เฉพาะตอนที่ API จะไม่ปฏิเสธแน่ ๆ */
export function voidGate(sale: {
  saleType: string;
  deletedAt?: string | null;
  exchangeCase?: { caseNumber: string } | null;
}): VoidGate {
  if (sale.deletedAt) return { kind: 'none' };
  if (!VOIDABLE_SALE_TYPES.has(sale.saleType)) {
    return {
      kind: 'text',
      text: 'ยกเลิกผ่านสัญญา',
      title: 'ใบขายผ่อนร้านยกเลิกผ่านหน้าสัญญา (ยกเลิกสัญญา) ไม่ใช่ที่นี่',
    };
  }
  if (sale.exchangeCase) {
    return {
      kind: 'text',
      text: `เปลี่ยนเครื่องแล้ว · ${sale.exchangeCase.caseNumber}`,
      title: 'ใบขายที่เปลี่ยนรุ่นเดิมแล้วยกเลิกไม่ได้ — ให้ฝ่ายบัญชีแก้รายการถ้าจำเป็น',
    };
  }
  return { kind: 'button' };
}
