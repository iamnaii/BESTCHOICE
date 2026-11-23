import { downloadExcelBuffer } from '@/utils/excel.util';
import { GFIN_IMPORT_HEADERS } from '../gfinPriceListImport';
import { GFIN_IMPORT_TERM_HEADERS } from './gfinImportTerms';

/** แบบฟอร์มใบราคา: รุ่น · ความจุ · มือ · ราคา + OVER · ผ่อนสูงสุด (ไม่บังคับ — สเปก §6.2 ข้อ 3) */
export async function downloadGfinTemplate(): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ใบราคา GFIN');
  const headers = [...GFIN_IMPORT_HEADERS, ...GFIN_IMPORT_TERM_HEADERS];
  ws.columns = headers.map((header) => ({ header, key: header, width: header === 'รุ่น' ? 22 : 14 }));
  ws.addRows([
    { 'รุ่น': 'iPhone 17 Pro Max', 'ความจุ': '256GB', 'มือ 1/มือ 2': 'มือ 1', 'ราคา': 44900, OVER: 2000, 'ผ่อนสูงสุด': 15 },
    { 'รุ่น': 'iPhone 13', 'ความจุ': '128GB', 'มือ 1/มือ 2': 'มือ 2', 'ราคา': 12900, OVER: 1000, 'ผ่อนสูงสุด': 12 },
  ]);
  downloadExcelBuffer(await wb.xlsx.writeBuffer(), 'แบบฟอร์มใบราคา-GFIN.xlsx');
}
