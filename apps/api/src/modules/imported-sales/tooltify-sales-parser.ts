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

export interface ParsedSale {
  source: string;
  barcode: string;
  productName: string;
  category: string;
  buyerLabel: string;
  shopLabel: string | null;
  orderNumber: string;
  paymentType: string;
  priceGroup: string;
  saleChannel: string;
  costTotal: string;
  listPrice: string;
  salePrice: string;
  profit: string;
  salespersonName: string;
  soldAt: Date;
  importBatch: string;
}

const DETAIL_SECTION_PREFIX = 'รายการขาย (';

export function parseSalesLineItems(
  rows: string[][],
  opts: { importBatch: string },
): ParsedSale[] {
  const cell = (r: string[], i: number) => (r[i] ?? '').trim();

  // 1) locate the "รายการขาย ( N )" section title row
  const sectionIdx = rows.findIndex((r) => cell(r, 0).startsWith(DETAIL_SECTION_PREFIX));
  if (sectionIdx === -1) return [];

  // 2) header is the next non-empty row; data starts after it
  let headerIdx = sectionIdx + 1;
  while (headerIdx < rows.length && cell(rows[headerIdx], 0) === '') headerIdx++;
  const out: ParsedSale[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const barcode = cell(r, 0);
    if (barcode === '') break; // blank row terminates the table
    const shop = cell(r, 4);
    out.push({
      source: 'TOOLTIFY',
      barcode,
      productName: cell(r, 1),
      category: cell(r, 2),
      buyerLabel: cell(r, 3),
      shopLabel: shop === '' || shop === '-' ? null : shop,
      orderNumber: cell(r, 5),
      paymentType: normalizePayment(cell(r, 6)),
      priceGroup: cell(r, 7),
      saleChannel: deriveSaleChannel(cell(r, 7)),
      costTotal: cell(r, 8) || '0',
      listPrice: cell(r, 9) || '0',
      salePrice: cell(r, 10) || '0',
      profit: cell(r, 11) || '0',
      salespersonName: cell(r, 12),
      soldAt: parseThaiDateTime(cell(r, 13)),
      importBatch: opts.importBatch,
    });
  }
  return out;
}
