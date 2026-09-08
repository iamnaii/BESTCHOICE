/** Minimum evidence recorded at physical intake, not for an online estimate. */
export interface TradeInEvidence {
  sellerName?: string | null;
  sellerPhone?: string | null;
  sellerIdCardNumber?: string | null;
  sellerAddress?: string | null;
  imei?: string | null;
  serialNumber?: string | null;
  imeiMissingReason?: string | null;
  serialNumberMissingReason?: string | null;
}

export function tradeInSellerEvidenceError(e: TradeInEvidence): string | null {
  if (!e.sellerName?.trim()) return 'กรุณาระบุชื่อผู้ขายตามบัตรประชาชน';
  const id = e.sellerIdCardNumber?.trim() ?? '';
  const sum = [...id.slice(0, 12)].reduce((total, digit, i) => total + Number(digit) * (13 - i), 0);
  if (!/^\d{13}$/.test(id) || (11 - sum % 11) % 10 !== Number(id[12])) return 'กรุณาระบุเลขบัตรประชาชนผู้ขายให้ถูกต้อง';
  if (!/^\d{9,10}$/.test(e.sellerPhone?.trim() ?? '')) return 'กรุณาระบุเบอร์โทรผู้ขาย 9–10 หลัก';
  if (!e.sellerAddress?.trim()) return 'กรุณาระบุที่อยู่ผู้ขายตามหลักฐาน';
  return null;
}

export function tradeInEvidenceError(e: TradeInEvidence): string | null {
  const sellerError = tradeInSellerEvidenceError(e);
  if (sellerError) return sellerError;
  if (!e.imei?.trim() && !e.serialNumber?.trim()) return 'ต้องมี IMEI หรือ Serial Number อย่างน้อยหนึ่งรายการ';
  if (e.imei && !/^\d{15}$/.test(e.imei)) return 'IMEI ต้องเป็นตัวเลข 15 หลัก';
  if ((e.serialNumber?.length ?? 0) > 100) return 'Serial Number ต้องไม่เกิน 100 ตัวอักษร';
  if (!e.imei && !e.imeiMissingReason?.trim()) return 'กรุณาระบุเหตุผลที่ไม่มี IMEI';
  if (!e.serialNumber?.trim() && !e.serialNumberMissingReason?.trim()) return 'กรุณาระบุเหตุผลที่ไม่มี Serial Number';
  if ((e.imeiMissingReason?.length ?? 0) > 300 || (e.serialNumberMissingReason?.length ?? 0) > 300) return 'เหตุผลต้องไม่เกิน 300 ตัวอักษร';
  return null;
}
