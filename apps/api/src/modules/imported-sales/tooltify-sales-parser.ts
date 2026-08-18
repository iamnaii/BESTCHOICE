const CHANNEL_BY_PRICE_GROUP: Record<string, string> = {
  'ราคาปลีก': 'CASH',
  'ราคา 2': 'INSTALLMENT',
  'ราคา 3': 'EXTERNAL_FINANCE',
};

export function deriveSaleChannel(priceGroup: string): string {
  return CHANNEL_BY_PRICE_GROUP[(priceGroup ?? '').trim()] ?? 'OTHER';
}

const PAYMENT_MAP: Record<string, string> = {
  'ขายแบบเงินสด': 'CASH',
  'ขายแบบโอน': 'BANK_TRANSFER',
  'ขายแบบสแกน QR': 'QR_EWALLET',
  'ขายแบบเครดิต': 'CREDIT_BALANCE',
};

export function normalizePayment(raw: string): string {
  const t = (raw ?? '').trim();
  if (!t) return 'UNKNOWN';
  return PAYMENT_MAP[t] ?? t;
}

export function parseThaiDateTime(raw: string): Date {
  const t = (raw ?? '').trim();
  // ISO already (exceljs may hand back a Date -> toISOString upstream)
  if (t.includes('T')) return new Date(t);
  // "YYYY-MM-DD HH:mm:ss" — treat as Asia/Bangkok (+07:00)
  return new Date(t.replace(' ', 'T') + '+07:00');
}
