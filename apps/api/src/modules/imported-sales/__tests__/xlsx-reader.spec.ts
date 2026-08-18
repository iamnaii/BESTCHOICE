import ExcelJS from 'exceljs';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readXlsxRows } from '../xlsx-reader';

async function writeTmpXlsx(rows: (string | number)[][]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Worksheet');
  rows.forEach((r) => ws.addRow(r));
  const p = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'xlsx-')), 't.xlsx');
  await wb.xlsx.writeFile(p);
  return p;
}

describe('readXlsxRows', () => {
  it('returns rows as string matrix with empty cells as ""', async () => {
    const p = await writeTmpXlsx([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
    const rows = await readXlsxRows(p);
    expect(rows[0]).toEqual(['a', 'b', 'c']);
    expect(rows[1][1]).toBe('');
    expect(rows[1][2]).toBe('3');
  });
});
