import ExcelJS from 'exceljs';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseThaiDateTime } from '../tooltify-sales-parser';
import { STOCK_SNAPSHOT_COLUMNS } from '../tooltify-stock-parser';
import { parseStockSnapshot } from '../tooltify-stock-snapshot-parser';
import { readXlsxRows, readXlsxTable, XlsxReadError } from '../xlsx-reader';

describe('Excel reader', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xlsx-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function writeWorkbook(fill: (sheet: ExcelJS.Worksheet) => void): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    fill(workbook.addWorksheet('Worksheet'));
    const file = path.join(dir, 'fixture.xlsx');
    await workbook.xlsx.writeFile(file);
    return file;
  }

  it('keeps the legacy string-matrix wrapper', async () => {
    const file = await writeWorkbook((sheet) => {
      sheet.addRow(['a', 'b', 'c']);
      const row = sheet.addRow([1, '', '3']);
      row.getCell(1).numFmt = '000';
    });
    await expect(readXlsxRows(file)).resolves.toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('preserves the sheet name plus leading, interior, and physical row gaps', async () => {
    const file = await writeWorkbook((sheet) => {
      sheet.getCell('C2').value = 'third column';
      sheet.getCell('B4').value = 'fourth row';
      sheet.getCell('D4').value = 12;
    });
    await expect(readXlsxTable(file)).resolves.toEqual({
      sheet: 'Worksheet',
      rows: [[], ['', '', 'third column'], [], ['', 'fourth row', '', '12']],
    });
  });

  it('decodes cached formula results and rich text', async () => {
    const file = await writeWorkbook((sheet) => {
      sheet.getCell('A1').value = { formula: '1-1', result: 0 };
      sheet.getCell('B1').value = { formula: '1=0', result: false };
      sheet.getCell('C1').value = { richText: [{ text: '01234' }, { text: '5678901234' }] };
    });
    await expect(readXlsxRows(file)).resolves.toEqual([['0', 'false', '012345678901234']]);
  });

  it('treats an Excel date as Thai wall time at the boundary of a day', async () => {
    const file = await writeWorkbook((sheet) => {
      sheet.getCell('A1').value = new Date('2026-11-21T00:05:01.000Z');
      sheet.getCell('B1').value = '2026-11-21 00:05:01';
    });
    const { rows } = await readXlsxTable(file);
    expect(rows[0][0]).toBe('2026-11-21T00:05:01+07:00');
    expect(rows[0].map((value) => parseThaiDateTime(value).toISOString())).toEqual([
      '2026-11-20T17:05:01.000Z',
      '2026-11-20T17:05:01.000Z',
    ]);
  });

  async function parseStockWorkbook(
    barcode: ExcelJS.CellValue,
    numFmt?: string,
    costNumFmt?: string,
  ) {
    const file = await writeWorkbook((sheet) => {
      sheet.addRow(Object.values(STOCK_SNAPSHOT_COLUMNS));
      const row = sheet.addRow([
        barcode,
        'fixture iPhone',
        'iPhone มือ 1',
        '',
        '',
        0,
        '2026-11-21 00:05:01',
        '',
        8000,
        1,
      ]);
      if (numFmt) row.getCell(1).numFmt = numFmt;
      if (costNumFmt) row.getCell(9).numFmt = costNumFmt;
    });
    const { sheet, rows } = await readXlsxTable(file);
    return parseStockSnapshot(rows, {
      file: {
        sha256: 'a'.repeat(64),
        kind: 'STOCK_SNAPSHOT',
        path: file,
        branchId: 'fixture-branch',
        storeKey: 'fixture-store',
        reportFrom: null,
        reportTo: null,
      },
      sheet,
      canonicalSetId: 'fixture-cutover',
    });
  }

  it.each([
    ['012345678901234', '000000000000000', '012345678901234'],
    [12345678901234, undefined, '12345678901234'],
    [123456789012345, '000000000000000', '123456789012345'],
  ])(
    'preserves exact barcode %s through Excel reading and snapshot parsing',
    async (barcode, format, expected) => {
      const result = await parseStockWorkbook(barcode, format);
      expect(result.issues).toEqual([]);
      expect(result.rows).toEqual([expect.objectContaining({ barcode: expected })]);
    },
  );

  it('preserves the cost when the workbook displays it with leading zeros', async () => {
    const result = await parseStockWorkbook('012345678901234', undefined, '00000.00');
    expect(result.issues).toEqual([]);
    expect(result.rows).toEqual([
      expect.objectContaining({ barcode: '012345678901234', cost: '8000.00' }),
    ]);
  });

  it.each<ExcelJS.CellValue>([
    12345678901234,
    { formula: '12345678901234', result: 12345678901234 },
  ])(
    'blocks zero-padded numeric IMEI %j before the snapshot parser receives a shortened value',
    async (barcode) => {
      const read = parseStockWorkbook(barcode, '000000000000000');
      await expect(read).rejects.toBeInstanceOf(XlsxReadError);
      await expect(read).rejects.toMatchObject({
        sheet: 'Worksheet',
        row: 2,
        column: 1,
        code: 'AMBIGUOUS_NUMERIC_VALUE',
      });
    },
  );

  it('finds a reordered barcode column after a physical row gap', async () => {
    const file = await writeWorkbook((sheet) => {
      const columns = STOCK_SNAPSHOT_COLUMNS;
      sheet.addRow([columns.cost, columns.category, columns.name, columns.barcode]);
      sheet.getCell('A3').value = 8000;
      sheet.getCell('A3').numFmt = '00000.00';
      sheet.getCell('D3').value = 12345678901234;
      sheet.getCell('D3').numFmt = '000000000000000';
    });
    await expect(readXlsxTable(file)).rejects.toMatchObject({
      sheet: 'Worksheet',
      row: 3,
      column: 4,
      code: 'AMBIGUOUS_NUMERIC_VALUE',
    });
  });

  it('ends barcode-format validation at the next Tooltify report section', async () => {
    const file = await writeWorkbook((sheet) => {
      const columns = STOCK_SNAPSHOT_COLUMNS;
      sheet.addRow([columns.barcode, columns.category, columns.name]);
      sheet.addRow(['012345678901234', 'iPhone มือ 1', 'fixture']);
      sheet.addRow(['รายการจ่ายเครดิต ( 1 )']);
      sheet.addRow(['ต้นทุนรวม']);
      const total = sheet.addRow([8000]);
      total.getCell(1).numFmt = '00000.00';
    });
    const { rows } = await readXlsxTable(file);
    expect(rows[4]).toEqual(['8000']);
  });

  const unsupported: [string, ExcelJS.CellValue, string][] = [
    ['uncached formula', { formula: 'fixture-secret()' }, 'FORMULA_WITHOUT_RESULT'],
    ['Excel error', { error: '#REF!' }, 'UNSUPPORTED_CELL_VALUE'],
    ['integer beyond Excel precision', 1234567890123450, 'UNSAFE_NUMERIC_VALUE'],
  ];
  it.each(unsupported)('reports coordinates for %s', async (_description, value, code) => {
    const file = await writeWorkbook((sheet) => {
      sheet.getCell('D4').value = value;
    });
    const read = readXlsxTable(file);
    await expect(read).rejects.toBeInstanceOf(XlsxReadError);
    await expect(read).rejects.toMatchObject({ sheet: 'Worksheet', row: 4, column: 4, code });
  });
});
