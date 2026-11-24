import { validStockSourceMapping } from '../../cli/tooltify-cutover/stock-source-mapping';
import type { SourceDecision } from '../../cli/tooltify-cutover/types';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type {
  CanonicalStockUnit,
  FileRef,
  ImportIssue,
  ParseResult,
  SourceRef,
} from '../../cli/tooltify-cutover/types';
import {
  deriveBrandModel,
  isImeiBarcode,
  parseBatteryHealth,
  STOCK_SNAPSHOT_COLUMNS,
} from './tooltify-stock-parser';

const COLUMNS = STOCK_SNAPSHOT_COLUMNS;
const REQUIRED_COLUMNS = Object.values(COLUMNS);
const CATEGORY_MAP = new Map<
  string,
  Pick<CanonicalStockUnit, 'kind' | 'category' | 'deviceOrigin'>
>([
  ['iPhone มือ 1', { kind: 'DEVICE', category: 'PHONE_NEW', deviceOrigin: null }],
  ['iPhone มือ 2', { kind: 'DEVICE', category: 'PHONE_USED', deviceOrigin: null }],
  [
    'iPhone มือ 2 (เครื่องนอก)',
    { kind: 'DEVICE', category: 'PHONE_USED', deviceOrigin: 'IMPORTED' },
  ],
  ['iPad มือ 1', { kind: 'DEVICE', category: 'TABLET', deviceOrigin: null }],
  ['Accessories', { kind: 'ACCESSORY', category: 'ACCESSORY', deviceOrigin: null }],
]);

function readCost(raw: string): string | null {
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) return null;
  const value = new Prisma.Decimal(raw.replace(/,/g, ''));
  if (
    !value.isFinite() ||
    value.isNegative() ||
    value.decimalPlaces() > 2 ||
    value.greaterThan('9999999999.99')
  )
    return null;
  return value.toFixed(2);
}

function readImportedAt(raw: string): string | null {
  const match =
    /^(\d{4}-\d{2}-\d{2})[T ]((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?)(Z|[+-]\d{2}:\d{2})?$/.exec(
      raw,
    );
  if (!match) return null;
  const [, day, time, offset = '+07:00'] = match;
  const midnight = new Date(day + 'T00:00:00Z');
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== day) {
    return null;
  }
  const date = new Date(`${day}T${time}${offset}`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function parseStockSnapshot(
  rows: string[][],
  context: { file: FileRef; sheet: string; canonicalSetId: string; decisions?: SourceDecision[] },
): ParseResult<CanonicalStockUnit> {
  const { file, sheet, canonicalSetId } = context;
  const { sha256: fileSha256, storeKey, branchId } = file;
  const result: ParseResult<CanonicalStockUnit> = { rows: [], issues: [] };
  const issue = (code: ImportIssue['code'], message: string, source: SourceRef | null) =>
    result.issues.push({ code, source, message });
  const sourceAt = (row: number): SourceRef => ({ fileSha256, sheet, row, storeKey });

  if (file.kind !== 'STOCK_SNAPSHOT') {
    issue('UNEXPECTED_SOURCE_KIND', 'ต้องใช้ไฟล์รายงานสต๊อกคงเหลือ', null);
    return result;
  }

  const headers = rows
    .map((cells, index) => ({ headings: cells.map((cell) => cell.trim()), index }))
    .filter(
      ({ headings }) =>
        [COLUMNS.barcode, COLUMNS.category, COLUMNS.importedAt].filter((column) =>
          headings.includes(column),
        ).length >= 2,
    );
  if (headers.length !== 1) {
    issue('UNRECOGNIZED_REPORT', 'ต้องมีหัวตารางรายละเอียดสต๊อกหนึ่งตาราง', null);
    return result;
  }
  const [{ headings, index: headerIndex }] = headers;
  const invalidColumns = REQUIRED_COLUMNS.filter(
    (column) =>
      headings.indexOf(column) < 0 || headings.indexOf(column) !== headings.lastIndexOf(column),
  );
  if (invalidColumns.length) {
    issue(
      'UNRECOGNIZED_COLUMNS',
      'หัวคอลัมน์ขาดหรือซ้ำ ' + invalidColumns.join(', '),
      sourceAt(headerIndex + 1),
    );
    return result;
  }
  const columnIndices = new Map(headings.map((column, index) => [column, index]));
  const devicesByBarcode = new Map<string, SourceRef[]>();
  let detailCount = 0;

  for (let index = headerIndex + 1; index < rows.length; index++) {
    const cells = rows[index];
    if (!cells.some((cell) => cell.trim())) continue;
    detailCount++;
    const source = sourceAt(index + 1);
    const get = (column: string) => (cells[columnIndices.get(column)!] ?? '').trim();
    const issuesBeforeRow = result.issues.length;
    const barcode = get(COLUMNS.barcode);
    const name = get(COLUMNS.name);
    const mappings = (context.decisions ?? []).filter(
      (d): d is Extract<SourceDecision, { action: 'MAP_STOCK_ITEM' }> =>
        d.action === 'MAP_STOCK_ITEM' &&
        d.fileSha256 === fileSha256 &&
        d.sourceRows.includes(source.row),
    );
    const mapping =
      mappings.length === 1 &&
      validStockSourceMapping(mappings[0], source, barcode, name, get(COLUMNS.category))
        ? mappings[0]
        : null;
    if (mappings.length && !mapping)
      issue('INVALID_STOCK_SOURCE_MAPPING', 'หลักฐานหมวดหมู่ไม่ตรงกับแถวต้นทาง', source);
    const category = mapping
      ? {
          kind: mapping.category === 'TABLET' ? ('DEVICE' as const) : ('ACCESSORY' as const),
          category: mapping.category,
          deviceOrigin: null,
        }
      : CATEGORY_MAP.get(get(COLUMNS.category));
    const cost = readCost(get(COLUMNS.cost));
    const importedAt = readImportedAt(get(COLUMNS.importedAt));
    const details = get(COLUMNS.details);
    const batteryHealth = category?.kind === 'DEVICE' ? parseBatteryHealth(details) : null;
    if (category?.kind === 'DEVICE' && /แบตเตอรี่/.test(details) && batteryHealth === null)
      issue('INVALID_BATTERY_HEALTH', 'เปอร์เซ็นต์แบตเตอรี่ไม่ถูกต้องหรือขัดกัน', source);

    if (!category) issue('UNKNOWN_SOURCE_CATEGORY', 'หมวดหมู่ต้นทางว่างหรือยังไม่รู้จัก', source);
    if (category?.kind === 'DEVICE') {
      if (isImeiBarcode(barcode) || mapping?.category === 'TABLET') {
        const matches = devicesByBarcode.get(barcode) ?? [];
        matches.push(source);
        devicesByBarcode.set(barcode, matches);
      } else {
        issue('INVALID_DEVICE_IMEI', 'บาร์โค้ดเครื่องต้องเป็นเลข 14–15 หลัก', source);
      }
    } else if (!barcode) {
      issue('MISSING_SOURCE_IDENTITY', 'บาร์โค้ดสินค้าว่าง', source);
    }
    if (!name) issue('MISSING_STOCK_NAME', 'ชื่อสินค้าว่าง', source);
    if (cost === null) issue('INVALID_STOCK_COST', 'ต้นทุนสินค้าว่างหรือไม่ถูกต้อง', source);
    if (!importedAt) issue('INVALID_SOURCE_DATE', 'วันที่นำเข้าไม่ถูกต้อง', source);
    if (!branchId?.trim() || branchId.trim() === 'UNRESOLVED') {
      issue('UNRESOLVED_STOCK_BRANCH', 'ต้องยืนยันสาขาของไฟล์สต๊อก', source);
    }
    if (!storeKey.trim() || storeKey.trim() === 'UNRESOLVED') {
      issue('UNRESOLVED_SOURCE_STORE', 'ต้องยืนยันร้านต้นทางของไฟล์สต๊อก', source);
    }

    if (
      !category ||
      cost === null ||
      !importedAt ||
      !branchId ||
      result.issues.length > issuesBeforeRow
    )
      continue;
    const identity =
      category.kind === 'DEVICE'
        ? [storeKey, barcode]
        : [canonicalSetId, fileSha256, sheet, source.row, 1];

    result.rows.push({
      source,
      ...(mapping ? { sourceMapping: mapping } : {}),
      ...(columnIndices.has(COLUMNS.supplier) ? { supplierLabel: get(COLUMNS.supplier) } : {}),
      sourceKey: createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
      ...category,
      ...(batteryHealth !== null ? { batteryHealth } : {}),
      barcode,
      name,
      ...deriveBrandModel(name, category.category),
      cost,
      cashPrice: null,
      installmentPrice: null,
      financePrice: null,
      branchId,
      // The stock check flag has no evidenced mapping to an inventory status.
      sourceStatus: null,
      desiredStatus: null,
      importedAt,
      priceEvidence: null,
    });
  }

  if (!detailCount) issue('EMPTY_SNAPSHOT', 'ตารางสต๊อกไม่มีแถวรายละเอียด', null);

  const duplicateSources = new Set<SourceRef>();
  for (const matches of devicesByBarcode.values()) {
    if (matches.length < 2) continue;
    for (const source of matches) {
      duplicateSources.add(source);
      issue('DUPLICATE_IMEI', 'IMEI ซ้ำในรายงานสต๊อก', source);
    }
  }
  result.rows = result.rows.filter(({ source }) => !duplicateSources.has(source));
  return result;
}
