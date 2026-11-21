import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { collectSections, SALES_COLUMNS, publicWorksheetName } from './tooltify-report-layout';
import { parseThaiDateTime, sourceTimestamp } from './tooltify-date';
import type {
  CanonicalSaleLine,
  FileRef,
  GrossSalesTotals,
  SalesReportResult,
  SourceRef,
} from '../../cli/tooltify-cutover/types';
import { isImeiBarcode } from './tooltify-stock-parser';

export { parseThaiDateTime };

const CHANNEL_BY_PRICE_GROUP: Record<string, string> = {
  ราคาปลีก: 'CASH',
  'ราคา 2': 'INSTALLMENT',
  'ราคา 3': 'EXTERNAL_FINANCE',
};

export function deriveSaleChannel(priceGroup: string): string {
  return CHANNEL_BY_PRICE_GROUP[(priceGroup ?? '').trim()] ?? 'OTHER';
}

const PAYMENT_MAP: Record<string, string> = {
  ขายแบบเงินสด: 'CASH',
  ขายแบบโอน: 'BANK_TRANSFER',
  'ขายแบบสแกน QR': 'QR_EWALLET',
  ขายแบบเครดิต: 'CREDIT_BALANCE',
};

export function normalizePayment(raw: string): string {
  const t = (raw ?? '').trim();
  if (!t) return 'UNKNOWN';
  return PAYMENT_MAP[t] ?? t;
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

export function parseSalesLineItems(rows: string[][], opts: { importBatch: string }): ParsedSale[] {
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

export function saleSourceKey(
  sale: Pick<CanonicalSaleLine, 'sourceStoreKey' | 'orderNumber' | 'barcode' | 'soldAt'>,
  occurrence: number,
): string {
  const tuple = [
    sale.sourceStoreKey,
    sale.orderNumber,
    sale.barcode,
    sale.soldAt.toISOString(),
    occurrence,
  ];
  return createHash('sha256').update(JSON.stringify(tuple)).digest('hex');
}

const MONEY_COLUMNS = {
  costTotal: 'ต้นทุนรวม',
  listPrice: 'ราคาตั้งขาย',
  salePrice: 'ราคาขาย',
  profit: 'กำไร',
} as const;
const moneyFields = Object.keys(MONEY_COLUMNS) as (keyof typeof MONEY_COLUMNS)[];
const SUMMARY_COLUMNS = [
  'รูปแบบการขาย',
  'คำสั่งซื้อ',
  'รายการขาย',
  ...Object.values(MONEY_COLUMNS),
];
const ADJUSTMENTS = new Map([
  ['รายการจ่ายเครดิต', 'รายการจ่ายเครดิต'],
  ['ไฟแนนซ์', 'ตัดสต๊อกทำสัญญาไฟแนนซ์'],
  ['เบิกอะไหล่', 'เบิกอะไหล่ไปซ่อม'],
  ['ทำเรื่องเคลมสินค้า', 'ทำเรื่องเคลมสินค้า'],
  ['คืนสินค้า', 'คืนสินค้า'],
  ['ยกเลิกการขาย', 'ยกเลิกการขาย'],
]);
const paymentSummaryLabels = new Set([...Object.keys(PAYMENT_MAP), 'ขายแบบเครดิต / ยอดหนี้']);

function saleMoney(raw: string, detail: boolean): string | null {
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) return null;
  const value = new Prisma.Decimal(raw.replace(/,/g, ''));
  if (value.decimalPlaces() > 2 || (detail && value.abs().greaterThan('9999999999.99')))
    return null;
  return value.toFixed(2);
}

function readCount(raw: string): number | null {
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw)) return null;
  const count = Number(raw.replace(/,/g, ''));
  return Number.isSafeInteger(count) ? count : null;
}

function readGrossSummary(
  rows: string[][],
  end: number,
  result: SalesReportResult,
  sourceAt: (row: number) => SourceRef,
): void {
  const headers = rows
    .slice(0, end)
    .map((r, i) => ({ headings: r.map((cell) => cell.trim()), i }))
    .filter(({ headings }) => headings.includes('รายการขาย') && headings.includes('รูปแบบการขาย'));
  if (!headers.length) {
    const summaryRow = rows
      .slice(0, end)
      .findIndex((cells) => cells.some((cell) => cell.trim() === 'ขายสินค้าทั้งหมด'));
    if (summaryRow !== -1)
      result.issues.push({
        code: 'INVALID_SALES_SUMMARY',
        source: sourceAt(summaryRow + 1),
        message: 'พบยอดขายสินค้าทั้งหมดที่ไม่มีหัวตารางสรุป',
      });
    return;
  }
  const [{ headings, i: header }] = headers;
  if (
    headers.length !== 1 ||
    SUMMARY_COLUMNS.some((column) => headings.filter((c) => c === column).length !== 1)
  ) {
    result.issues.push({
      code: 'INVALID_SALES_SUMMARY',
      source: sourceAt(header + 1),
      message: 'หัวตารางสรุปยอดขายขาดหรือซ้ำ',
    });
    return;
  }
  let grossCount = 0;
  for (let index = header + 1; index < end; index++) {
    const cells = rows[index];
    if (!cells.some((cell) => cell.trim())) continue;
    const get = (column: string) => (cells[headings.indexOf(column)] ?? '').trim();
    const label = get('รูปแบบการขาย');
    if (paymentSummaryLabels.has(label)) continue;
    const source = sourceAt(index + 1);
    const gross = label === 'ขายสินค้าทั้งหมด';
    const values = {
      bills: readCount(get('คำสั่งซื้อ')),
      lines: readCount(get('รายการขาย')),
      costTotal: saleMoney(get(MONEY_COLUMNS.costTotal), false),
      listPrice: saleMoney(get(MONEY_COLUMNS.listPrice), false),
      salePrice: saleMoney(get(MONEY_COLUMNS.salePrice), false),
      profit: saleMoney(get(MONEY_COLUMNS.profit), false),
    };
    if (!gross) {
      const adjustment = ADJUSTMENTS.get(label);
      result.adjustments.push({
        label: adjustment ?? 'ส่วนรายงานที่ไม่รู้จัก',
        source,
        declaredRows: null,
        detailRows: [],
        reported: values,
      });
      const rawColumns = SUMMARY_COLUMNS.slice(1);
      if (
        !adjustment ||
        Object.values(values).some((v, i) => v === null && get(rawColumns[i]) !== '-')
      ) {
        result.issues.push({
          code: 'INVALID_SALES_SUMMARY',
          source,
          message: 'สรุปเหตุการณ์มีรูปแบบหรือยอดที่ไม่รู้จัก',
        });
      }
      if (
        Object.values(values).some((value) => value !== null && !new Prisma.Decimal(value).isZero())
      ) {
        result.issues.push({
          code: 'UNRECONCILED_SALE_EVENTS',
          source,
          message: 'ต้องตรวจเหตุการณ์และผูกกับเอกสารต้นทาง',
        });
      }
      continue;
    }
    grossCount++;
    const { bills, lines, costTotal, listPrice, salePrice, profit } = values;
    if (
      bills === null ||
      lines === null ||
      costTotal === null ||
      listPrice === null ||
      salePrice === null ||
      profit === null
    ) {
      result.issues.push({
        code: 'INVALID_SALES_SUMMARY',
        source,
        message: 'จำนวนหรือยอดเงินสรุปไม่ถูกต้อง',
      });
      continue;
    }
    const reported = { bills, lines, costTotal, listPrice, salePrice, profit };
    result.gross.reported = reported;
    const detail = result.gross.detail;
    if (!detail) continue;
    const delta = { ...reported, bills: bills - detail.bills, lines: lines - detail.lines };
    for (const key of moneyFields)
      delta[key] = new Prisma.Decimal(reported[key]).minus(detail[key]).toFixed(2);
    result.gross.delta = delta;
    if (Object.values(delta).some((v) => !new Prisma.Decimal(v).isZero())) {
      const differences = moneyFields.map((key) => MONEY_COLUMNS[key] + ' ' + delta[key]);
      result.issues.push({
        code: 'SALES_SUMMARY_MISMATCH',
        source,
        message:
          'สรุปลบรายละเอียด: บิล ' +
          delta.bills +
          ' รายการ ' +
          delta.lines +
          ' ' +
          differences.join(' '),
      });
    }
  }
  if (grossCount !== 1)
    result.issues.push({
      code: 'INVALID_SALES_SUMMARY',
      source: sourceAt(header + 1),
      message: 'ตารางสรุปต้องมียอดขายสินค้าทั้งหมดหนึ่งแถว',
    });
}

export function parseSalesReport(
  rows: string[][],
  context: { file: FileRef; sheet: string },
): SalesReportResult {
  const { file } = context;
  const sheet = publicWorksheetName(context.sheet);
  const sourceAt = (row: number): SourceRef => ({
    fileSha256: file.sha256,
    storeKey: file.storeKey,
    sheet,
    row,
  });
  const result: SalesReportResult = {
    rows: [],
    issues: [],
    gross: { reported: null, detail: null, delta: null },
    adjustments: [],
  };
  if (file.kind !== 'SALES') {
    result.issues.push({
      code: 'UNEXPECTED_SOURCE_KIND',
      source: null,
      message: 'ต้องใช้รายงานขาย',
    });
    return result;
  }
  const sections = collectSections(rows);
  const sales = sections.filter((s) => s.label === 'รายการขาย');
  if (sales.length !== 1) {
    result.issues.push({
      code: 'UNRECOGNIZED_REPORT',
      source: null,
      message: 'ต้องมีตารางรายการขายหนึ่งตาราง',
    });
    return result;
  }
  const [section] = sales;
  const endOf = (s: typeof section) => sections[sections.indexOf(s) + 1]?.startIndex ?? rows.length;
  for (const s of sections) {
    if (s === section || paymentSummaryLabels.has(s.label)) continue;
    const detailRows: number[] = [];
    for (let i = s.headerIndex + 1; i < endOf(s); i++)
      if (rows[i].some((cell) => cell.trim())) detailRows.push(i + 1);
    const source = sourceAt(s.startIndex + 1);
    result.adjustments.push({
      source,
      label: s.label,
      declaredRows: s.declaredRowCount,
      detailRows,
      reported: null,
    });
    if (detailRows.length || s.declaredRowCount)
      result.issues.push({
        code: 'UNRECONCILED_SALE_EVENTS',
        source,
        message: 'ต้องตรวจเหตุการณ์นอกตารางขายและผูกกับเอกสารต้นทาง',
      });
  }
  const headings = (rows[section.headerIndex] ?? []).map((cell) => cell.trim());
  if (SALES_COLUMNS.some((column) => headings.filter((value) => value === column).length !== 1)) {
    result.issues.push({
      code: 'UNRECOGNIZED_COLUMNS',
      source: sourceAt(section.headerIndex + 1),
      message: 'หัวตารางรายการขายขาดหรือซ้ำ',
    });
    return result;
  }
  const columns = new Map(headings.map((c, i) => [c, i]));
  const bills = new Set<string>();
  const detail: GrossSalesTotals = {
    bills: 0,
    lines: 0,
    costTotal: '0.00',
    salePrice: '0.00',
    listPrice: '0.00',
    profit: '0.00',
  };
  let completeGross = true;
  for (let i = section.headerIndex + 1; i < endOf(section); i++) {
    const cells = rows[i];
    if (!cells.some((c) => c.trim())) continue;
    detail.lines++;
    const source = sourceAt(i + 1);
    const before = result.issues.length;
    const issue = (code: string, message: string) => result.issues.push({ code, source, message });
    const get = (column: string) => (cells[columns.get(column)!] ?? '').trim();
    const barcode = get('บาร์โค้ดสินค้า'),
      orderNumber = get('คำสั่งซื้อ'),
      category = get('หมวดหมู่สินค้า');
    if (orderNumber) bills.add(orderNumber);
    else completeGross = false;
    if (!barcode || !orderNumber) issue('MISSING_SOURCE_IDENTITY', 'ต้องระบุบาร์โค้ดและเลขที่บิล');
    const device =
      ['iPhone มือ 1', 'iPhone มือ 2', 'iPhone มือ 2 (เครื่องนอก)'].includes(category) ||
      /^(?:ipad|tablet)\b/i.test(category);
    if (device && !isImeiBarcode(barcode))
      issue('INVALID_PHONE_BARCODE', 'บาร์โค้ดเครื่องต้องเป็นเลข 14–15 หลัก');
    if (!device && category !== 'Accessories')
      issue('UNKNOWN_SOURCE_CATEGORY', 'หมวดหมู่ต้นทางว่างหรือยังไม่รู้จัก');
    if (!file.storeKey.trim() || file.storeKey.trim() === 'UNRESOLVED')
      issue('UNRESOLVED_SOURCE_STORE', 'ต้องยืนยันร้านต้นทางของรายงานขาย');
    if (!file.branchId?.trim() || file.branchId.trim() === 'UNRESOLVED')
      issue('UNRESOLVED_SALES_BRANCH', 'ต้องยืนยันสาขาของรายงานขาย');
    const timestamp = sourceTimestamp(get('วันที่ขายสินค้า'));
    if (!timestamp) issue('INVALID_SOURCE_DATE', 'วันที่ขายไม่ถูกต้อง');
    const money = {} as Pick<GrossSalesTotals, keyof typeof MONEY_COLUMNS>;
    for (const key of moneyFields) {
      const column = MONEY_COLUMNS[key];
      const amount = saleMoney(get(column), true);
      if (amount === null) {
        issue('INVALID_SALE_MONEY', 'จำนวนเงินไม่ถูกต้องในคอลัมน์ ' + column);
        completeGross = false;
      } else {
        money[key] = amount;
        detail[key] = new Prisma.Decimal(detail[key]).plus(amount).toFixed(2);
      }
    }
    if (!timestamp || result.issues.length !== before) continue;
    const soldAt = new Date(timestamp);
    const identity = { sourceStoreKey: file.storeKey, orderNumber, barcode, soldAt };
    const shop = get('ร้านค้า'),
      priceGroup = get('กลุ่มราคาขาย');
    result.rows.push({
      ...identity,
      ...money,
      source,
      sourceKey: saleSourceKey(identity, 1),
      occurrence: 1,
      productName: get('ชื่อสินค้า'),
      category,
      buyerLabel: get('ผู้ซื้อสินค้า'),
      shopLabel: shop === '-' || !shop ? null : shop,
      paymentType: normalizePayment(get('รูปแบบการขาย')),
      priceGroup,
      saleChannel: deriveSaleChannel(priceGroup),
      salespersonName: get('ผู้ขายสินค้า'),
    });
  }
  detail.bills = bills.size;
  if (completeGross) result.gross.detail = detail;
  if (detail.lines !== section.declaredRowCount)
    result.issues.push({
      code: 'SECTION_COUNT_MISMATCH',
      source: sourceAt(section.startIndex + 1),
      message: 'จำนวนรายการขายต่างจากหัวตาราง',
    });
  readGrossSummary(rows, sections[0].startIndex, result, sourceAt);
  return result;
}
