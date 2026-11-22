import { STOCK_SNAPSHOT_COLUMNS } from './tooltify-stock-parser';

export const SALES = 'รายการขาย';
export const SNAPSHOT = 'รายละเอียดสต๊อก';
const STOCK_SUMMARY = 'สรุปสต๊อก';
export const BARCODE = 'บาร์โค้ดสินค้า';
export const SALE_DATE = 'วันที่ขายสินค้า';
export const STOCK_DATE = 'วันที่นำเข้า';
export const CATEGORY = 'หมวดหมู่สินค้า';
export const BILL = 'คำสั่งซื้อ';
export const STORE = 'ร้านค้า';
export const META_COLUMNS = [
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
  'รวมต้นทุน',
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
export const SALES_COLUMNS = [
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
export const STOCK_COLUMNS = Object.values(STOCK_SNAPSHOT_COLUMNS);
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

export function publicWorksheetName(name: string): string {
  return ['Worksheet', 'Sheet1'].includes(name) ? name : 'worksheet-1';
}

function text(cell: string | undefined): string {
  return (cell ?? '').trim();
}

function sectionLabel(value: string, nextRow: string[]): string | null {
  if (SECTION_LABELS.has(value)) return value;
  if (/^(?:รายการ|ทำเรื่อง)?(?:คืนสินค้า|รับคืนสินค้า|คืนเงิน)/.test(value)) return 'คืนสินค้า';
  if (/^(?:รายการ|ทำเรื่อง)?ยกเลิก/.test(value)) return 'ยกเลิกการขาย';
  if (!nextRow.some((cell) => META_COLUMNS.includes(text(cell)))) return null;
  return nextRow.length >= 2 ? 'ส่วนรายงานที่ไม่รู้จัก' : null;
}

export function collectSections(rows: string[][]) {
  const sections: {
    label: string;
    startIndex: number;
    headerIndex: number;
    declaredRowCount: number | null;
  }[] = [];
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
        sections.push({
          label,
          startIndex: index,
          headerIndex,
          declaredRowCount: Number(title[2].replace(/,/g, '')),
        });
        return;
      }
    }
    if (STOCK_COLUMNS.every((column) => values.includes(column))) {
      sections.push({
        label: SNAPSHOT,
        startIndex: index,
        headerIndex: index,
        declaredRowCount: null,
      });
    } else if (first === 'ชื่อสินค้า' && index < 5 && values.includes('จำนวน')) {
      sections.push({
        label: STOCK_SUMMARY,
        startIndex: index,
        headerIndex: index,
        declaredRowCount: null,
      });
    }
  });
  return sections;
}
