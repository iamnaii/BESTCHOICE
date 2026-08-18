import {
  deriveSaleChannel,
  normalizePayment,
  parseThaiDateTime,
  parseSalesLineItems,
  ParsedSale,
} from '../tooltify-sales-parser';

describe('deriveSaleChannel', () => {
  it('maps price groups to sale channels', () => {
    expect(deriveSaleChannel('ราคาปลีก')).toBe('CASH');
    expect(deriveSaleChannel('ราคา 2')).toBe('INSTALLMENT');
    expect(deriveSaleChannel('ราคา 3')).toBe('EXTERNAL_FINANCE');
    expect(deriveSaleChannel('ราคา 4')).toBe('OTHER');
    expect(deriveSaleChannel('  ราคา 2 ')).toBe('INSTALLMENT'); // trims
    expect(deriveSaleChannel('')).toBe('OTHER');
  });
});

describe('normalizePayment', () => {
  it('maps Thai payment labels', () => {
    expect(normalizePayment('ขายแบบเงินสด')).toBe('CASH');
    expect(normalizePayment('ขายแบบโอน')).toBe('BANK_TRANSFER');
    expect(normalizePayment('ขายแบบสแกน QR')).toBe('QR_EWALLET');
    expect(normalizePayment('ขายแบบเครดิต')).toBe('CREDIT_BALANCE');
    expect(normalizePayment('อื่นๆ')).toBe('อื่นๆ'); // passthrough unknown
    expect(normalizePayment('')).toBe('UNKNOWN');
  });
});

describe('parseThaiDateTime', () => {
  it('parses "YYYY-MM-DD HH:mm:ss" as Bangkok time', () => {
    const d = parseThaiDateTime('2026-08-18 13:46:40');
    // 13:46:40 +07:00 === 06:46:40 UTC
    expect(d.toISOString()).toBe('2026-08-18T06:46:40.000Z');
  });
  it('accepts an ISO string too (exceljs Date cell path)', () => {
    const d = parseThaiDateTime('2026-08-18T06:46:40.000Z');
    expect(d.toISOString()).toBe('2026-08-18T06:46:40.000Z');
  });
});

const HEADER = [
  'บาร์โค้ดสินค้า','ชื่อสินค้า','หมวดหมู่สินค้า','ผู้ซื้อสินค้า','ร้านค้า',
  'คำสั่งซื้อ','รูปแบบการขาย','กลุ่มราคาขาย','ต้นทุนรวม','ราคาตั้งขาย',
  'ราคาขาย','กำไร','ผู้ขายสินค้า','วันที่ขายสินค้า',
];

function mkRows(): string[][] {
  return [
    ['สรุปยอดการขายสินค้า 2026-07-01 ถึง 2026-08-31'],
    [],
    ['รูปแบบการขาย','คำสั่งซื้อ','รายการขาย'], // summary block (ignored)
    ['ขายแบบเงินสด','17','49'],
    [],
    ['เบิกอะไหล่ไปซ่อม ( 0 )'],               // other section title (ignored)
    ['บาร์โค้ดสินค้า','ชื่อสินค้า','งานซ่อม'], // other section header (ignored)
    [],
    ['รายการขาย ( 2 )'],                       // <-- the detail section title
    HEADER,
    ['350630609144613','iPhone 17 Pro 256GB Silver (สีเงิน)','iPhone มือ 2','GFIN',
      'บริษัท จีฟินน์ จำกัด','1246','ขายแบบโอน','ราคา 3','37900','40063','40063','2163',
      'ภานุมาส ศรีวิลัย ( หมวย )','2026-08-18 13:46:40'],
    ['F17P01','ฟิล์มกระจก iPhone 17 Pro - iStar','Accessories','ลูกค้าทั่วไป','-',
      '1244','ขายแบบเงินสด','ราคาปลีก','35','0','0','-35',
      'ภานุมาส ศรีวิลัย ( หมวย )','2026-08-17 18:13:44'],
    [],                                        // blank terminates the table
    ['ignored trailing row'],
  ];
}

describe('parseSalesLineItems', () => {
  it('reads only the "รายการขาย" detail table and maps fields', () => {
    const out = parseSalesLineItems(mkRows(), { importBatch: 'file-A.xlsx' });
    expect(out).toHaveLength(2);
    const a = out[0];
    expect(a).toMatchObject<Partial<ParsedSale>>({
      source: 'TOOLTIFY',
      barcode: '350630609144613',
      productName: 'iPhone 17 Pro 256GB Silver (สีเงิน)',
      category: 'iPhone มือ 2',
      buyerLabel: 'GFIN',
      shopLabel: 'บริษัท จีฟินน์ จำกัด',
      orderNumber: '1246',
      paymentType: 'BANK_TRANSFER',
      priceGroup: 'ราคา 3',
      saleChannel: 'EXTERNAL_FINANCE',
      costTotal: '37900',
      salePrice: '40063',
      profit: '2163',
      salespersonName: 'ภานุมาส ศรีวิลัย ( หมวย )',
      importBatch: 'file-A.xlsx',
    });
    expect(a.soldAt.toISOString()).toBe('2026-08-18T06:46:40.000Z');
    expect(out[1].shopLabel).toBeNull(); // '-' -> null
    expect(out[1].saleChannel).toBe('CASH');
  });

  it('returns [] when no detail section present', () => {
    expect(parseSalesLineItems([['x'], ['y']], { importBatch: 'f' })).toEqual([]);
  });

  it('skips rows with empty barcode', () => {
    const rows = [['รายการขาย ( 1 )'], HEADER, ['', 'x', 'y'], ['']];
    expect(parseSalesLineItems(rows, { importBatch: 'f' })).toEqual([]);
  });
});
