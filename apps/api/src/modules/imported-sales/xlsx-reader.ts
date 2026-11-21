import ExcelJS from 'exceljs';

const CELL_ERROR_MESSAGES = {
  FORMULA_WITHOUT_RESULT: 'สูตร Excel ไม่มีผลลัพธ์ที่บันทึกไว้',
  UNSUPPORTED_CELL_VALUE: 'ชนิดข้อมูลในเซลล์ Excel ไม่รองรับ',
  UNSAFE_NUMERIC_VALUE: 'ตัวเลขเกินขอบเขตความแม่นยำของ Excel',
  AMBIGUOUS_NUMERIC_VALUE: 'รูปแบบตัวเลข Excel เติมศูนย์นำหน้า กรุณาตรวจค่าต้นทาง',
} as const;

type XlsxCellErrorCode = keyof typeof CELL_ERROR_MESSAGES;

export class XlsxReadError extends Error {
  constructor(
    readonly code: XlsxCellErrorCode,
    readonly sheet: string,
    readonly row: number,
    readonly column: number,
  ) {
    super(`${CELL_ERROR_MESSAGES[code]} (แถว ${row} คอลัมน์ ${column})`);
    this.name = 'XlsxReadError';
  }
}

function decodeCell(cell: ExcelJS.Cell, sheet: string, row: number, column: number): string {
  // Merged titles occupy only the master cell in the source table.
  if (cell.type === ExcelJS.ValueType.Merge) return '';

  const fail = (code: XlsxCellErrorCode): never => {
    throw new XlsxReadError(code, sheet, row, column);
  };

  const formula = cell.type === ExcelJS.ValueType.Formula;
  // ExcelJS's formula object omits falsy results. The result getter retains them.
  const value = formula ? cell.result : cell.value;
  if (value == null) return formula ? fail('FORMULA_WITHOUT_RESULT') : '';

  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    // Excel numeric identifiers carry at most 15 decimal digits. Preserve the stored
    // digits without padding from a number format or guessing lost digits.
    if (!Number.isFinite(value) || Math.abs(value) >= 1e15) return fail('UNSAFE_NUMERIC_VALUE');
    const stored = String(value);
    // A zero placeholder can change the identifier shown in Excel. Check the
    // positive section's integer width before discarding the number format.
    const integerFormat = /^(?:\[[^\]]*\])*([#0,]+)(?=[.;]|$)/.exec(cell.numFmt?.trim() ?? '')?.[1];
    const minimumDigits = integerFormat?.replace(/[^0]/g, '').length ?? 0;
    if (value >= 0 && Number.isInteger(value) && minimumDigits > stored.length) {
      return fail('AMBIGUOUS_NUMERIC_VALUE');
    }
    return stored;
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return fail('UNSUPPORTED_CELL_VALUE');
    // ExcelJS puts the spreadsheet's timezone-free clock into the Date's UTC fields.
    return value.toISOString().replace(/(?:\.000)?Z$/, '+07:00');
  }
  if ('richText' in value) return value.richText.map(({ text }) => text).join('');
  if ('hyperlink' in value) return value.text;
  return fail('UNSUPPORTED_CELL_VALUE');
}

/** Physical, zero-indexed row and column positions in one Tooltify worksheet. */
export function decodeXlsxWorksheet(worksheet: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const cells: string[] = [];
    for (let column = 1; column <= row.cellCount; column++) {
      cells[column - 1] = decodeCell(row.getCell(column), worksheet.name, rowNumber, column);
    }
    rows[rowNumber - 1] = cells;
  }
  return rows;
}

export async function readXlsxTable(
  filePath: string,
): Promise<{ sheet: string; rows: string[][] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('ไฟล์ Excel ไม่มีเวิร์กชีต');
  return { sheet: worksheet.name, rows: decodeXlsxWorksheet(worksheet) };
}

export async function readXlsxRows(filePath: string): Promise<string[][]> {
  return (await readXlsxTable(filePath)).rows;
}
