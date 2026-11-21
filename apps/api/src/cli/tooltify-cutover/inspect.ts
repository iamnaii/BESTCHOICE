import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { Readable } from 'node:stream';
import { isImeiBarcode } from '../../modules/imported-sales/tooltify-stock-parser';
import type { DateRange, FileInspection, InspectionReport, SourceRef } from './types';

const SALES = 'รายการขาย';
const SNAPSHOT = 'รายละเอียดสต๊อก';
const STOCK_SUMMARY = 'สรุปสต๊อก';
const BARCODE = 'บาร์โค้ดสินค้า';
const SALE_DATE = 'วันที่ขายสินค้า';
const STOCK_DATE = 'วันที่นำเข้า';
const CATEGORY = 'หมวดหมู่สินค้า';
const BILL = 'คำสั่งซื้อ';
const STORE = 'ร้านค้า';
const META_COLUMNS = [
  BARCODE,
  'ชื่อสินค้า',
  CATEGORY,
  BILL,
  STORE,
  SALE_DATE,
  STOCK_DATE,
  'แหล่งที่มา',
  'รายละเอียดสินค้า',
  'เช็คสต๊อก',
  'ผู้นำเข้า',
  'ต้นทุนสินค้า',
  'No.',
  'ผู้ซื้อสินค้า',
  'รูปแบบการขาย',
  'กลุ่มราคาขาย',
  'ต้นทุนรวม',
  'ราคาตั้งขาย',
  'ราคาขาย',
  'กำไร',
  'ผู้ขายสินค้า',
  'ราคาปลีก',
  'ราคา 2',
  'ราคา 3',
  'ราคา 4',
  'ราคาเบิกซ่อม',
  'จำนวน',
  'จำนวนสินค้า',
  'จำนวนคงเหลือ',
  'เลขที่สัญญา',
  'ชื่อลูกค้า',
  'ราคาตัดสต๊อกเพื่อทำสัญญา',
  'ผู้บันทึก',
  'วันที่ทำรายการ',
  'งานซ่อม',
  'อุปกรณ์',
  'serial เครื่อง',
  'ต้นทุนอะไหล่',
  'ราคาอะไหล่',
  'ราคาเบิกไป',
  'ผู้เบิกอะไหล่',
  'วันที่เบิกอะไหล่',
  'เพิ่มเงิน',
  'ผู้เคลมสินค้า',
  'วันที่เคลม',
  'เลขที่ออเดอร์',
  'ยอดรวม',
  'ยอดขาย',
  'วันที่',
];
const SALES_COLUMNS = [
  BARCODE,
  'ชื่อสินค้า',
  CATEGORY,
  'ผู้ซื้อสินค้า',
  STORE,
  BILL,
  'รูปแบบการขาย',
  'กลุ่มราคาขาย',
  'ต้นทุนรวม',
  'ราคาตั้งขาย',
  'ราคาขาย',
  'กำไร',
  'ผู้ขายสินค้า',
  SALE_DATE,
];
const STOCK_COLUMNS = [
  BARCODE,
  'ชื่อสินค้า',
  CATEGORY,
  'แหล่งที่มา',
  'รายละเอียดสินค้า',
  'เช็คสต๊อก',
  STOCK_DATE,
  'ผู้นำเข้า',
  'ต้นทุนสินค้า',
  'No.',
];
const SECTION_LABELS = new Set([
  SALES,
  'ขายแบบเงินสด',
  'ขายแบบโอน',
  'ขายแบบสแกน QR',
  'ขายแบบเครดิต',
  'ขายแบบเครดิต / ยอดหนี้',
  'รายการจ่ายเครดิต',
  'ตัดสต๊อกทำสัญญาไฟแนนซ์',
  'เบิกอะไหล่ไปซ่อม',
  'ทำเรื่องเคลมสินค้า',
]);
const PHONE_CATEGORIES = new Set(['iPhone มือ 1', 'iPhone มือ 2', 'iPhone มือ 2 (เครื่องนอก)']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Cell = string | Date;
type DuplicateCandidate = {
  kind: 'STOCK_IMEI' | 'SALE_LINE_KEY';
  source: SourceRef;
  key: string;
  cells: Cell[];
};

export function isCalendarDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function overlap(left: DateRange | null, right: DateRange | null): DateRange | null {
  if (!left || !right) return null;
  const start = left.start > right.start ? left.start : right.start;
  const end = left.end < right.end ? left.end : right.end;
  return start <= end ? { start, end } : null;
}

function text(cell: Cell | undefined): string {
  return cell instanceof Date ? cell.toISOString() : (cell ?? '').trim();
}

// Excel dates are timezone-free wall times; the export's calendar is Asia/Bangkok.
function sourceTimestamp(cell: Cell | undefined): string | null {
  const match =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/.exec(
      text(cell),
    );
  if (!match) return null;
  const [, day, hours, minutes, seconds, fraction = '', offset] = match;
  if (!isCalendarDay(day) || +hours > 23 || +minutes > 59 || +seconds > 59) return null;
  const date = new Date(
    `${day}T${hours}:${minutes}:${seconds}${fraction}${cell instanceof Date ? '+07:00' : (offset ?? '+07:00')}`,
  );
  if (!Number.isFinite(date.getTime())) return null;
  const local = new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString();
  return local.replace(/(?:\.000)?Z$/, '+07:00');
}

function filenameRange(name: string, kind: FileInspection['kind']): DateRange | null {
  const dates =
    kind === 'SALES'
      ? /^report_export_stock_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})(?:_|\.)/.exec(name)
      : /^report_stock_(\d{4}-\d{2}-\d{2})(?:_|\.)/.exec(name);
  if (!dates) return null;
  const start = dates[1];
  const end = dates[2] ?? start;
  return isCalendarDay(start) && isCalendarDay(end) && start <= end ? { start, end } : null;
}

function sectionLabel(value: string, nextRow: Cell[]): string | null {
  if (SECTION_LABELS.has(value)) return value;
  if (/^(?:รายการ|ทำเรื่อง)?(?:คืนสินค้า|รับคืนสินค้า|คืนเงิน)/.test(value)) return 'คืนสินค้า';
  if (/^(?:รายการ|ทำเรื่อง)?ยกเลิก/.test(value)) return 'ยกเลิกการขาย';
  if (!nextRow.some((cell) => META_COLUMNS.includes(text(cell)))) return null;
  return nextRow.length >= 2 ? 'ส่วนรายงานที่ไม่รู้จัก' : null;
}

function collectSections(rows: Cell[][]) {
  const sections: { label: string; headerIndex: number; declaredRowCount: number | null }[] = [];
  rows.forEach((row, index) => {
    const values = row.map(text);
    const first = values[0];
    const title = /^(.*?)\s*\(\s*([\d,]+)\s*\)$/.exec(first);
    if (title && values.slice(1).every((value) => !value)) {
      let headerIndex = index + 1;
      while (headerIndex < rows.length && rows[headerIndex].every((cell) => !text(cell)))
        headerIndex++;
      const label = sectionLabel(title[1], rows[headerIndex] ?? []);
      if (label) {
        sections.push({ label, headerIndex, declaredRowCount: Number(title[2].replace(/,/g, '')) });
        return;
      }
    }
    if (first === BARCODE && STOCK_COLUMNS.every((column) => values.includes(column))) {
      sections.push({ label: SNAPSHOT, headerIndex: index, declaredRowCount: null });
    } else if (first === 'ชื่อสินค้า' && index < 5 && values.includes('จำนวน')) {
      sections.push({ label: STOCK_SUMMARY, headerIndex: index, declaredRowCount: null });
    }
  });
  return sections;
}

async function inspectWorkbook(
  bytes: Buffer,
  file: FileInspection,
  candidates: DuplicateCandidate[],
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  // Parse the exact bytes being hashed. A path re-read could inspect a different revision.
  await workbook.xlsx.read(Readable.from([bytes]));
  if (workbook.worksheets.length !== 1) {
    file.issues.push({
      code: 'UNSUPPORTED_WORKSHEETS',
      source: null,
      message: 'ไฟล์ต้องมีหนึ่งเวิร์กชีต',
    });
    return;
  }
  const sheet = workbook.worksheets[0];
  file.sheet = ['Worksheet', 'Sheet1'].includes(sheet.name) ? sheet.name : 'worksheet-1';
  const rows: Cell[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: Cell[] = [];
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cells[column - 1] =
        cell.isMerged && cell.master.address !== cell.address
          ? ''
          : cell.value instanceof Date
            ? cell.value
            : cell.text;
    });
    rows.push(cells);
  });

  const sections = collectSections(rows);
  const detailSections = sections.filter(({ label }) => label === SALES || label === SNAPSHOT);
  if (detailSections.length !== 1) {
    file.issues.push({
      code: 'UNRECOGNIZED_REPORT',
      source: null,
      message: 'ไม่พบตารางรายละเอียดที่ระบุรูปแบบได้เพียงตารางเดียว',
    });
  }
  const detail = detailSections.length === 1 ? detailSections[0] : undefined;
  if (detail) file.kind = detail.label === SALES ? 'SALES' : 'STOCK_SNAPSHOT';

  const shopLabelGroups = new Map<string, FileInspection['shopLabelGroups'][number]>();
  const bills = new Set<string>();
  const times: string[] = [];

  for (const section of sections) {
    const { label, headerIndex, declaredRowCount } = section;
    const headings = (rows[headerIndex] ?? []).map(text);
    const columns = headings.filter((value) => META_COLUMNS.includes(value));
    const nextHeader =
      sections.find((other) => other.headerIndex > headerIndex)?.headerIndex ?? rows.length;
    const data: { cells: Cell[]; row: number }[] = [];
    for (
      let index = headerIndex + 1;
      index < nextHeader && rows[index].some((cell) => text(cell));
      index++
    ) {
      data.push({ cells: rows[index], row: index + 1 });
    }
    file.sections.push({
      label,
      headerRow: headerIndex + 1,
      columns,
      declaredRowCount,
      sourceRowCount: data.length,
    });
    if (declaredRowCount !== null && data.length !== declaredRowCount) {
      file.issues.push({
        code: 'SECTION_COUNT_MISMATCH',
        source: null,
        message: 'จำนวนแถวต่างจากหัวรายงานที่แถว ' + (headerIndex + 1),
      });
    }
    if (section !== detail) continue;

    const isSales = label === SALES;
    const expectedColumns = isSales ? SALES_COLUMNS : STOCK_COLUMNS;
    if (
      expectedColumns.some(
        (column) => headings.filter((heading) => heading === column).length !== 1,
      )
    ) {
      file.issues.push({
        code: 'UNRECOGNIZED_COLUMNS',
        source: null,
        message: 'ตารางรายละเอียดมีหัวคอลัมน์บังคับไม่ครบหรือซ้ำ',
      });
    }
    if (!isSales && !data.length) {
      file.issues.push({
        code: 'EMPTY_SNAPSHOT',
        source: null,
        message: 'ตารางสต๊อกไม่มีแถวรายละเอียดให้ตรวจสอบ',
      });
    }
    file.sourceRowCount = data.length;

    for (const { cells, row } of data) {
      const get = (column: string) => cells[headings.indexOf(column)];
      if (isSales) {
        const rawLabel = text(get(STORE));
        const labelKey = rawLabel === '-' ? '' : rawLabel;
        let group = shopLabelGroups.get(labelKey);
        if (!group) {
          group = { key: `row-${row}`, rowCount: 0, missingLabel: !labelKey };
          shopLabelGroups.set(labelKey, group);
        }
        group.rowCount++;
      }
      // ร้านค้า is a report line label. Export origin requires separate evidence.
      const source = { fileSha256: file.sha256, sheet: file.sheet, row, storeKey: 'UNRESOLVED' };
      const occurredAt = sourceTimestamp(get(isSales ? SALE_DATE : STOCK_DATE));
      file.rows.push({ row, occurredAt });
      if (occurredAt) times.push(occurredAt);
      else
        file.issues.push({ code: 'INVALID_SOURCE_DATE', source, message: 'วันที่ในแถวไม่ถูกต้อง' });

      const category = text(get(CATEGORY));
      const barcode = text(get(BARCODE));
      const phoneCategory = PHONE_CATEGORIES.has(category) || /^(?:ipad|tablet)\b/i.test(category);
      if (!phoneCategory && category !== 'Accessories') {
        file.issues.push({
          code: 'UNKNOWN_SOURCE_CATEGORY',
          source,
          message: 'หมวดหมู่ต้นทางว่างหรือยังไม่รู้จัก',
        });
      }
      if (phoneCategory && !isImeiBarcode(barcode)) {
        file.issues.push({
          code: 'INVALID_PHONE_BARCODE',
          source,
          message: 'บาร์โค้ดเครื่องต้องเป็นเลข 14–15 หลัก',
        });
      }
      const bill = text(get(BILL));
      if (isSales && bill) bills.add(bill);
      if (!barcode || (isSales && !bill)) {
        file.issues.push({
          code: 'MISSING_SOURCE_IDENTITY',
          source,
          message: 'บาร์โค้ดหรือเลขที่บิลว่าง',
        });
      }
      if (!isSales && phoneCategory && isImeiBarcode(barcode)) {
        candidates.push({ kind: 'STOCK_IMEI', source, key: barcode, cells });
      } else if (isSales && barcode && bill && occurredAt) {
        candidates.push({
          kind: 'SALE_LINE_KEY',
          source,
          key: JSON.stringify([barcode, bill, occurredAt]),
          cells,
        });
      }
    }
    if (isSales) {
      file.billCount = bills.size;
      file.shopLabelMeaning = 'UNRESOLVED';
    }
  }

  file.shopLabelGroups = [...shopLabelGroups.values()];
  if (times.length) {
    times.sort((a, b) => Date.parse(a) - Date.parse(b));
    file.actualRange = { start: times[0], end: times[times.length - 1] };
  }
}

export async function inspectFiles(paths: string[]): Promise<InspectionReport> {
  const report: InspectionReport = {
    version: 1,
    files: [],
    duplicateRows: [],
    salesOverlaps: [],
    issues: [],
  };
  const byHash = new Map<string, FileInspection>();
  const candidates: DuplicateCandidate[] = [];

  for (const path of paths) {
    try {
      if (extname(path).toLowerCase() !== '.xlsx') throw new Error();
      const bytes = await readFile(path);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const name = basename(path);
      const existing = byHash.get(sha256);
      if (existing) {
        if (!existing.fileNames.includes(name)) existing.fileNames.push(name);
        continue;
      }
      const file: FileInspection = {
        sha256,
        fileNames: [name],
        byteSize: bytes.length,
        kind: 'UNKNOWN',
        sheet: '',
        declaredRange: null,
        actualRange: null,
        sections: [],
        sourceRowCount: 0,
        billCount: null,
        rows: [],
        shopLabelMeaning: null,
        shopLabelGroups: [],
        issues: [],
      };
      byHash.set(sha256, file);
      try {
        await inspectWorkbook(bytes, file, candidates);
      } catch {
        file.issues.push({
          code: 'INVALID_WORKBOOK',
          source: null,
          message: 'อ่านโครงสร้างไฟล์ Excel ไม่ได้',
        });
      }
    } catch {
      report.issues.push({
        code: 'UNREADABLE_FILE',
        source: null,
        message: 'อ่านไฟล์ .xlsx ตามรายการที่ระบุไม่ได้',
      });
    }
  }

  report.files = [...byHash.values()];
  for (const file of report.files) {
    const ranges = file.fileNames.map((name) => filenameRange(name, file.kind)).filter(Boolean);
    const [range] = ranges;
    if (
      range &&
      ranges.every((other) => other?.start === range.start && other?.end === range.end)
    ) {
      file.declaredRange = range;
    } else if (range) {
      file.issues.push({
        code: 'CONFLICTING_REPORT_DATES',
        source: null,
        message: 'สำเนาไฟล์เดียวกันระบุช่วงวันที่ต่างกัน',
      });
    }
  }

  const groups = new Map<string, DuplicateCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.key}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [first] = group;
    const row = JSON.stringify(first.cells);
    report.duplicateRows.push({
      kind: first.kind,
      identical: group.every((entry) => JSON.stringify(entry.cells) === row),
      rows: group.map((entry) => entry.source),
    });
  }

  const salesFiles = report.files.filter((file) => file.kind === 'SALES');
  for (const [index, left] of salesFiles.entries()) {
    for (const right of salesFiles.slice(index + 1)) {
      const throughDays = (range: DateRange | null) =>
        range && { start: range.start.slice(0, 10), end: range.end.slice(0, 10) };
      const declaredRange = overlap(left.declaredRange, right.declaredRange);
      const actualRange = overlap(throughDays(left.actualRange), throughDays(right.actualRange));
      if (declaredRange || actualRange) {
        report.salesOverlaps.push({
          fileSha256s: [left.sha256, right.sha256],
          declaredRange,
          actualRange,
        });
      }
    }
  }
  return report;
}
