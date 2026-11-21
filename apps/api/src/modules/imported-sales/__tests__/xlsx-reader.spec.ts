import ExcelJS from 'exceljs';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseThaiDateTime } from '../tooltify-sales-parser';
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
      sheet.addRow(['1', '', '3']);
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

  it('leaves leading zeros intact in strings and does not pad numeric identifiers', async () => {
    const file = await writeWorkbook((sheet) => {
      sheet.getCell('A1').value = '012345678901234';
      sheet.getCell('B1').value = 12345678901234;
      sheet.getCell('B1').numFmt = '000000000000000';
    });
    await expect(readXlsxRows(file)).resolves.toEqual([['012345678901234', '12345678901234']]);
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
