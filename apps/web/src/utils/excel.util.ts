// Dynamic import: ExcelJS is ~600KB. We only load it when the user
// actually clicks "Export" or "Import" — keeps the initial bundle slim
// for the 90% of pages that never touch xlsx.
//
// Vite's manualChunks splits exceljs into its own chunk, and the
// `import('exceljs')` calls below trigger the chunk download lazily.

export interface ExcelColumn {
  header: string;
  key: string;
  width: number;
}

// Reuse the type without forcing the runtime import.
type ExcelBuffer = ArrayBuffer;

export function downloadExcelBuffer(buffer: ExcelBuffer, filename: string): void {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportToExcel(options: {
  data: Record<string, unknown>[];
  columns: ExcelColumn[];
  sheetName: string;
  filename: string;
}): Promise<void> {
  const { data, columns, sheetName, filename } = options;

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns;

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

  ws.addRows(data);

  const buffer = await wb.xlsx.writeBuffer();
  downloadExcelBuffer(buffer as ArrayBuffer, filename);
}

export async function importFromExcel(file: File): Promise<Record<string, unknown>[]> {
  const ExcelJS = (await import('exceljs')).default;
  const arrayBuffer = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount <= 1) return [];

  const headerRow = ws.getRow(1);
  const colIndex: Record<string, number> = {};
  headerRow.eachCell((cell, colNumber) => {
    colIndex[String(cell.value || '').trim()] = colNumber;
  });

  const rows: Record<string, unknown>[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, unknown> = {};
    for (const [header, col] of Object.entries(colIndex)) {
      obj[header] = row.getCell(col).value;
    }
    rows.push(obj);
  });

  return rows;
}
