/**
 * Flow A (สต๊อกจริง) — PURE parsing/reconstruction functions for Tooltify stock-import files.
 * No I/O here — the CLI (`apps/api/src/cli/import-tooltify-stock.cli.ts`) does file reads +
 * PrismaClient writes and calls into these functions.
 *
 * Source columns (detail table, header row where col0 === 'บาร์โค้ดสินค้า'):
 *   [0] บาร์โค้ดสินค้า  [1] ชื่อสินค้า  [2] หมวดหมู่สินค้า  [3] ต้นทุนสินค้า  [4] ราคาปลีก
 *   [5] ราคา 2  [6] ราคา 3  [7] ราคา 4  [8] ราคาเบิกซ่อม  [9] แหล่งที่มา
 *   [10] รายละเอียดสินค้า  [11] วันที่นำเข้า  [12] ผู้นำเข้า
 *
 * See docs/superpowers/specs/2026-08-18-tooltify-import-design.md §5.1 + §6.
 */
import { parseThaiDateTime } from './tooltify-sales-parser';

export type StockProductCategory = 'PHONE_NEW' | 'PHONE_USED' | 'TABLET' | 'ACCESSORY';

export interface ParsedStockImportRow {
  barcode: string; // IMEI (phone/tablet) or SKU (accessory) — trimmed
  name: string;
  categoryText: string; // raw Thai category text from the file
  cost: string;
  cashPrice: string; // ราคาปลีก
  installmentPrice: string; // ราคา 2 (BESTCHOICE finance)
  details: string; // รายละเอียดสินค้า — battery % + ผ่อน terms, multiline
  importDate: string; // raw "YYYY-MM-DD HH:mm:ss" text
  importBatch: string; // source file name
}

const HEADER_BARCODE_LABEL = 'บาร์โค้ดสินค้า';

/** Reads the single detail table out of a stock-import file (report_import_stock_*.xlsx). */
export function parseStockImportRows(
  rows: string[][],
  opts: { importBatch: string },
): ParsedStockImportRow[] {
  const cell = (r: string[], i: number) => (r[i] ?? '').trim();
  const headerIdx = rows.findIndex((r) => cell(r, 0) === HEADER_BARCODE_LABEL);
  if (headerIdx === -1) return [];

  const out: ParsedStockImportRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const barcode = cell(r, 0);
    if (barcode === '') break; // blank row terminates the table
    out.push({
      barcode,
      name: cell(r, 1),
      categoryText: cell(r, 2),
      cost: cell(r, 3) || '0',
      cashPrice: cell(r, 4) || '0',
      installmentPrice: cell(r, 5) || '0',
      details: cell(r, 10),
      importDate: cell(r, 11),
      importBatch: opts.importBatch,
    });
  }
  return out;
}

/** IMEI-shaped barcode = 14-15 all-numeric digits (mobile/tablet units). Anything else = accessory SKU. */
export function isImeiBarcode(barcode: string): boolean {
  return /^\d{14,15}$/.test((barcode ?? '').trim());
}

/** Maps Tooltify's Thai category text → BESTCHOICE ProductCategory (spec §5). */
export function mapStockCategory(categoryText: string): StockProductCategory {
  const t = (categoryText ?? '').trim();
  if (t === 'iPhone มือ 1') return 'PHONE_NEW';
  if (t === 'iPhone มือ 2') return 'PHONE_USED';
  if (/ipad|tablet/i.test(t)) return 'TABLET';
  return 'ACCESSORY'; // 'Accessories', empty (GIFT500 etc.), or anything unrecognized
}

/** Parses "% แบตเตอรี่ : NN%" out of the details column. null if absent/unparseable. */
export function parseBatteryHealth(details: string): number | null {
  const m = (details ?? '').match(/แบตเตอรี่\s*:?\s*(\d{1,3})\s*%/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export interface DerivedBrandModel {
  brand: string; // never '' — REQUIRED non-null Product field
  model: string; // never '' when name is non-empty — REQUIRED non-null Product field
  storage: string | null;
  color: string | null;
}

const STORAGE_RE = /(\d+)\s?(GB|TB)/i;
const COLOR_PAREN_RE = /\(([^)]+)\)/;
const APPLE_PREFIX_RE = /^i\s?(phone|pad)\b/i;

/**
 * Derives brand/model/storage/color from a Tooltify product name.
 * `category` selects the branch (phone/tablet-shaped name vs accessory-shaped name) —
 * driven by the row's mapped ProductCategory, not by which barcode-reconstruction bucket
 * it landed in (a handful of dirty rows have a phone category but a non-IMEI barcode, or
 * vice versa — name-parsing should still follow what the name actually looks like).
 *
 * FALLBACK (never null, spec §5.1): unparseable/empty name → brand='Unknown', model=name.
 */
export function deriveBrandModel(name: string, category: StockProductCategory): DerivedBrandModel {
  const n = (name ?? '').trim();
  if (!n) {
    return { brand: 'Unknown', model: n, storage: null, color: null };
  }

  if (category === 'ACCESSORY') {
    // "ชุดชาร์จ Type C to Type C - iStar" → vendor = text after the LAST ' - '
    const idx = n.lastIndexOf(' - ');
    const vendor = idx >= 0 ? n.slice(idx + 3).trim() : '';
    return { brand: vendor || '-', model: n, storage: null, color: null };
  }

  // phones / tablets
  const isApple = APPLE_PREFIX_RE.test(n);
  const firstWord = n.split(/\s+/)[0];
  const brand = isApple ? 'Apple' : firstWord || 'Unknown';

  const storageMatch = n.match(STORAGE_RE);
  const storage = storageMatch ? `${storageMatch[1]}${storageMatch[2].toUpperCase()}` : null;

  const colorMatch = n.match(COLOR_PAREN_RE);
  const color = colorMatch ? colorMatch[1].trim() : null;

  let model = n;
  if (storageMatch && typeof storageMatch.index === 'number') {
    const cut = n.slice(0, storageMatch.index).trim();
    if (cut) model = cut;
  }

  return { brand, model, storage, color };
}

// ---------------------------------------------------------------------------
// Reconstruction: "what's still in stock right now" from flow files
// (imported − sold), per design spec §6.2/§9 (A2 fallback — no A1 snapshot file).
// ---------------------------------------------------------------------------

export interface AccessoryStockUnit {
  sku: string;
  qty: number; // imported count − sold count, clamped ≥ 0
  source: ParsedStockImportRow; // latest import record for this SKU (attributes)
}

export interface ReconstructionResult {
  phones: ParsedStockImportRow[]; // one row per unique IMEI still in stock (latest import record)
  accessories: AccessoryStockUnit[]; // one entry per SKU with qty > 0
}

const DEFAULT_EXCLUDED_SKUS = ['GIFT500'];

/**
 * Reconstructs current stock from the full set of parsed import rows (all stock-import
 * files) and the flat list of sold barcodes (from every sales-export file's detail table,
 * one entry per line item — duplicates matter, they represent repeat sales of the same SKU).
 *
 * PHONES/TABLETS (IMEI-shaped barcode): dedup imported IMEIs (latest importDate wins),
 * current stock = imported IMEIs not present in the sold set.
 *
 * ACCESSORIES (non-IMEI barcode): per-SKU qty = timesImported − timesSold, clamp ≥ 0.
 * `excludeSkus` (default ['GIFT500']) is dropped entirely — not sellable stock.
 */
export function reconstructCurrentStock(
  importRows: ParsedStockImportRow[],
  soldBarcodes: string[],
  opts: { excludeSkus?: string[] } = {},
): ReconstructionResult {
  const excluded = new Set(opts.excludeSkus ?? DEFAULT_EXCLUDED_SKUS);

  const phoneRows = importRows.filter((r) => isImeiBarcode(r.barcode));
  const accessoryRows = importRows.filter((r) => !isImeiBarcode(r.barcode) && !excluded.has(r.barcode));

  // dedup phones by IMEI — latest import record wins
  const phoneByBarcode = new Map<string, ParsedStockImportRow>();
  for (const r of phoneRows) {
    const existing = phoneByBarcode.get(r.barcode);
    if (!existing || r.importDate > existing.importDate) {
      phoneByBarcode.set(r.barcode, r);
    }
  }
  const soldSet = new Set(soldBarcodes);
  const phones = [...phoneByBarcode.values()].filter((r) => !soldSet.has(r.barcode));

  // per-SKU imported/sold counts
  const soldCounts = new Map<string, number>();
  for (const b of soldBarcodes) soldCounts.set(b, (soldCounts.get(b) ?? 0) + 1);

  const importedCounts = new Map<string, number>();
  const latestBySku = new Map<string, ParsedStockImportRow>();
  for (const r of accessoryRows) {
    importedCounts.set(r.barcode, (importedCounts.get(r.barcode) ?? 0) + 1);
    const existing = latestBySku.get(r.barcode);
    if (!existing || r.importDate > existing.importDate) {
      latestBySku.set(r.barcode, r);
    }
  }

  const accessories: AccessoryStockUnit[] = [];
  for (const [sku, importedCount] of importedCounts) {
    const qty = Math.max(0, importedCount - (soldCounts.get(sku) ?? 0));
    if (qty > 0) {
      accessories.push({ sku, qty, source: latestBySku.get(sku)! });
    }
  }

  return { phones, accessories };
}

// ---------------------------------------------------------------------------
// Map to Product-create input
// ---------------------------------------------------------------------------

export interface BuildProductCtx {
  branchId: string;
  ownedByCompanyId: string;
}

export type ProductIdentity =
  | { kind: 'phone'; legacyProductCode: string }
  | { kind: 'accessory'; legacyProductCode: string };

export interface ProductCreateData {
  name: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  imeiSerial: string | null;
  category: StockProductCategory;
  costPrice: string;
  cashPrice: string;
  installmentPrice: string;
  branchId: string;
  ownedByCompanyId: string;
  status: 'IN_STOCK';
  batteryHealth: number | null;
  accessoryType: string | null;
  accessoryBrand: string | null;
  stockInDate: Date;
  legacyProductCode: string;
}

/** ราคา ≥ 0 validation (spec §5.1) — malformed/negative → '0', never NaN into a Decimal column. */
function sanitizeMoney(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return '0';
  return String(n);
}

/** Builds the legacyProductCode: TTFY-<IMEI> for phones, TTFY-<SKU>-<seq> for accessories. */
export function buildLegacyProductCode(identity: { kind: 'phone'; barcode: string }): string;
export function buildLegacyProductCode(identity: { kind: 'accessory'; sku: string; seq: number }): string;
export function buildLegacyProductCode(
  identity: { kind: 'phone'; barcode: string } | { kind: 'accessory'; sku: string; seq: number },
): string {
  if (identity.kind === 'phone') return `TTFY-${identity.barcode}`;
  return `TTFY-${identity.sku}-${identity.seq}`;
}

/** Maps one parsed row + resolved identity (phone unit or one accessory unit) → Product.createMany input. */
export function toProductCreateData(
  row: ParsedStockImportRow,
  ctx: BuildProductCtx,
  identity: ProductIdentity,
): ProductCreateData {
  const category = mapStockCategory(row.categoryText);
  const { brand, model, storage, color } = deriveBrandModel(row.name, category);
  const isPhone = identity.kind === 'phone';

  return {
    name: row.name || row.barcode,
    brand,
    model,
    color,
    storage,
    imeiSerial: isPhone ? row.barcode : null,
    category,
    costPrice: sanitizeMoney(row.cost),
    cashPrice: sanitizeMoney(row.cashPrice),
    installmentPrice: sanitizeMoney(row.installmentPrice),
    branchId: ctx.branchId,
    ownedByCompanyId: ctx.ownedByCompanyId,
    status: 'IN_STOCK',
    batteryHealth: isPhone ? parseBatteryHealth(row.details) : null,
    accessoryType: isPhone ? null : row.barcode,
    accessoryBrand: isPhone ? null : brand === '-' ? null : brand,
    stockInDate: parseThaiDateTime(row.importDate),
    legacyProductCode: identity.legacyProductCode,
  };
}
