import ExcelJS from 'exceljs';

/**
 * อ่านชีตแรกของไฟล์ .xlsx เป็น matrix ของ string.
 * cell ว่าง = ''; Date cell → ISO string (ให้ parseThaiDateTime รับต่อได้).
 */
export async function readXlsxRows(filePath: string): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value;
      if (v == null) cells.push('');
      else if (v instanceof Date) cells.push(v.toISOString());
      else if (typeof v === 'object' && 'text' in (v as object))
        cells.push(String((v as { text: unknown }).text)); // rich text
      else cells.push(String(v));
    });
    out.push(cells);
  });
  return out;
}
