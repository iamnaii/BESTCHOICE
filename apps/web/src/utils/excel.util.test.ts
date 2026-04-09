import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { importFromExcel } from './excel.util';

/**
 * importFromExcel parses payment-import xlsx files for the user.
 * If it silently drops rows or mis-maps columns, the user thinks they
 * imported 100 payments but only 87 actually got recorded — a real
 * data-loss bug. These tests pin the contract.
 *
 * Note: importFromExcel takes a `File`. We build an xlsx Buffer with
 * ExcelJS, wrap it in a File-like object that exposes `.arrayBuffer()`
 * (which is what the implementation actually awaits).
 */

interface SheetSpec {
  headers: string[];
  rows: unknown[][];
}

async function makeXlsxFile(sheet: SheetSpec | null): Promise<File> {
  const wb = new ExcelJS.Workbook();
  if (sheet) {
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(sheet.headers);
    for (const row of sheet.rows) ws.addRow(row);
  }
  const buffer = await wb.xlsx.writeBuffer();
  // The implementation only calls file.arrayBuffer(), so we don't need
  // a real Blob/File — a minimal duck-typed object works in jsdom.
  return {
    arrayBuffer: () => Promise.resolve(buffer as ArrayBuffer),
  } as unknown as File;
}

describe('importFromExcel', () => {
  describe('happy paths', () => {
    it('parses headers + rows into objects keyed by header text', async () => {
      const file = await makeXlsxFile({
        headers: ['contractNumber', 'amount', 'paidDate'],
        rows: [
          ['CNT-001', 1500, '2026-04-09'],
          ['CNT-002', 2000, '2026-04-08'],
        ],
      });

      const rows = await importFromExcel(file);

      expect(rows).toHaveLength(2);
      expect(rows[0].contractNumber).toBe('CNT-001');
      expect(rows[0].amount).toBe(1500);
      expect(rows[1].contractNumber).toBe('CNT-002');
    });

    it('preserves numeric types from cells (does not stringify)', async () => {
      const file = await makeXlsxFile({
        headers: ['amount'],
        rows: [[1234.56]],
      });

      const rows = await importFromExcel(file);
      expect(typeof rows[0].amount).toBe('number');
      expect(rows[0].amount).toBe(1234.56);
    });

    it('returns an empty array when the only row is the header', async () => {
      const file = await makeXlsxFile({
        headers: ['a', 'b'],
        rows: [],
      });

      const rows = await importFromExcel(file);
      expect(rows).toEqual([]);
    });
  });

  describe('edge cases that previously could swallow data', () => {
    it('returns [] for an empty workbook (no sheets)', async () => {
      const file = await makeXlsxFile(null);
      const rows = await importFromExcel(file);
      expect(rows).toEqual([]);
    });

    it('trims whitespace around header names', async () => {
      const file = await makeXlsxFile({
        headers: ['  contractNumber  ', '  amount  '],
        rows: [['CNT-1', 100]],
      });

      const rows = await importFromExcel(file);
      // Implementation trims headers, so the trimmed key is used:
      expect(rows[0].contractNumber).toBe('CNT-1');
      expect(rows[0].amount).toBe(100);
      // The padded key should NOT exist
      expect(rows[0]['  contractNumber  ']).toBeUndefined();
    });

    it('handles rows shorter than the header by leaving missing fields null', async () => {
      const file = await makeXlsxFile({
        headers: ['a', 'b', 'c'],
        rows: [
          ['x', 'y'], // missing c
        ],
      });

      const rows = await importFromExcel(file);
      expect(rows[0].a).toBe('x');
      expect(rows[0].b).toBe('y');
      // ExcelJS returns null for missing cells when accessed via getCell
      expect(rows[0].c == null).toBe(true);
    });

    it('keeps duplicate headers — last write wins', async () => {
      // Spreadsheets sometimes have duplicate column headers; document the
      // current behavior so a user importing such a file is not surprised.
      const file = await makeXlsxFile({
        headers: ['amount', 'amount'],
        rows: [[100, 200]],
      });

      const rows = await importFromExcel(file);
      // Last column wins because the colIndex map stores by header string
      expect(rows[0].amount).toBe(200);
    });

    it('processes 100 rows without dropping any', async () => {
      // Regression guard against off-by-one in the eachRow loop
      const rows = Array.from({ length: 100 }, (_, i) => [`CNT-${i + 1}`, i * 10]);
      const file = await makeXlsxFile({
        headers: ['contractNumber', 'amount'],
        rows,
      });

      const parsed = await importFromExcel(file);
      expect(parsed).toHaveLength(100);
      expect(parsed[0].contractNumber).toBe('CNT-1');
      expect(parsed[99].contractNumber).toBe('CNT-100');
      expect(parsed[99].amount).toBe(990);
    });
  });

  describe('robustness', () => {
    it('rejects when given a non-xlsx file', async () => {
      const garbage = {
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      } as unknown as File;

      await expect(importFromExcel(garbage)).rejects.toBeDefined();
    });
  });
});
