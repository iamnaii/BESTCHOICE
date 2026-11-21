import type { FileRef } from '../../../cli/tooltify-cutover/types';
import { inspectFiles } from '../../../cli/tooltify-cutover/inspect';
import { readXlsxTable } from '../xlsx-reader';
import ExcelJS from 'exceljs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  deriveSaleChannel,
  normalizePayment,
  parseThaiDateTime,
  parseSalesLineItems,
  parseSalesReport,
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

const file: FileRef = {
  path: 'synthetic.xlsx',
  sha256: 'a'.repeat(64),
  kind: 'SALES',
  storeKey: 'origin-A',
  branchId: 'branch-A',
  reportFrom: '2026-09-01',
  reportTo: '2026-09-30',
};
const context = { file, sheet: 'Worksheet' };
const gift = [
  'TEST-GIFT',
  'Synthetic gift',
  'Accessories',
  '',
  'Synthetic finance',
  'A-1',
  'ขายแบบโอน',
  'ราคา 3',
  '70.25',
  '0',
  '0',
  '-70.25',
  '',
  '2026-09-01 00:00:01',
];
const summary = [
  'รูปแบบการขาย',
  'คำสั่งซื้อ',
  'รายการขาย',
  'ต้นทุนรวม',
  'ราคาตั้งขาย',
  'ราคาขาย',
  'กำไร',
];
const totals = ['ขายสินค้าทั้งหมด', '1', '1', '70.25', '0', '0', '-70.25'];
const detail = [['รายการขาย ( 1 )'], HEADER, gift];

describe('parseSalesReport', () => {
  it('reads by headings and keeps zero gross sales, a negative profit and the Bangkok instant', () => {
    const result = parseSalesReport(
      [summary, totals, [], detail[0], [...HEADER].reverse(), [...gift].reverse()],
      context,
    );
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      source: { fileSha256: file.sha256, storeKey: file.storeKey, sheet: 'Worksheet', row: 6 },
      sourceStoreKey: file.storeKey,
      shopLabel: 'Synthetic finance',
      salePrice: '0.00',
      profit: '-70.25',
      soldAt: new Date('2026-08-31T17:00:01Z'),
    });
  });

  it.each([
    [13, '2026-02-30 00:00:00', 'INVALID_SOURCE_DATE'],
    [8, '', 'INVALID_SALE_MONEY'],
    [9, '1,2', 'INVALID_SALE_MONEY'],
    [10, 'bad', 'INVALID_SALE_MONEY'],
    [11, '0.001', 'INVALID_SALE_MONEY'],
  ] as const)('issues the physical row for invalid field %s (%s)', (column, value, code) => {
    const bad = [...gift];
    bad[column] = value;
    const result = parseSalesReport([[], detail[0], HEADER, bad], context);
    expect(result.rows).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code, source: expect.objectContaining({ row: 4 }) }),
    );
  });

  it('fails missing sections, ambiguous headers, and declared count discrepancies', () => {
    expect(parseSalesReport([summary, totals], context).issues).not.toHaveLength(0);
    expect(
      parseSalesReport([detail[0], [...HEADER, 'กำไร'], gift], context).issues,
    ).not.toHaveLength(0);
    expect(parseSalesReport([['รายการขาย ( 0 )'], HEADER, gift], context).issues).not.toHaveLength(
      0,
    );
  });

  it('reports separate signed gross/detail deltas without changing the supplied money', () => {
    const result = parseSalesReport(
      [summary, ['ขายสินค้าทั้งหมด', '1', '1', '75', '0', '10.11', '-60'], [], ...detail],
      context,
    );
    const issue = result.issues.find((i) => i.code === 'SALES_SUMMARY_MISMATCH');
    expect(issue?.source?.row).toBe(2);
    expect(issue?.message).toContain('ราคาขาย 10.11');
    expect(issue?.message).toContain('ต้นทุนรวม 4.75');
    expect(issue?.message).toContain('กำไร 10.25');
    expect(result.gross).toMatchObject({
      reported: { salePrice: '10.11', costTotal: '75.00', profit: '-60.00' },
      detail: { salePrice: '0.00', costTotal: '70.25', profit: '-70.25' },
      delta: { salePrice: '10.11', costTotal: '4.75', profit: '10.25' },
    });
    expect(result.rows[0].profit).toBe('-70.25');
    expect(
      parseSalesReport([summary, totals, [], ['รายการขาย ( 0 )'], HEADER], context).issues,
    ).not.toHaveLength(0);
  });

  it('keeps adjustments separate from gross and flags event evidence for reconciliation', () => {
    const result = parseSalesReport(
      [
        summary,
        totals,
        ['รายการจ่ายเครดิต', '-', '1', '-', '-', '10', '0'],
        [],
        ...detail,
        [],
        ['รายการคืนสินค้า ( 1 )'],
        ['คำสั่งซื้อ', 'ยอดขาย'],
        ['A-1', '-10'],
      ],
      context,
    );
    expect(result.gross.delta?.salePrice).toBe('0.00');
    expect(result.adjustments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'รายการจ่ายเครดิต',
          source: expect.objectContaining({ row: 3 }),
          reported: {
            bills: null,
            lines: 1,
            costTotal: null,
            listPrice: null,
            salePrice: '10.00',
            profit: '0.00',
          },
        }),
        expect.objectContaining({
          label: 'คืนสินค้า',
          source: expect.objectContaining({ row: 9 }),
          detailRows: [11],
        }),
      ]),
    );
    expect(result.issues.map((i) => i.code)).toContain('UNRECONCILED_SALE_EVENTS');
  });

  it('rejects a malformed identified summary instead of disregarding the reported total', () => {
    expect(
      parseSalesReport(
        [summary.map((h) => (h === 'รายการขาย' ? '' : h)), totals, [], ...detail],
        context,
      ).issues,
    ).toContainEqual(expect.objectContaining({ code: 'INVALID_SALES_SUMMARY' }));
  });

  it('requires origin and branch evidence and still reconciles the raw report', () => {
    const result = parseSalesReport([summary, totals, [], ...detail], {
      ...context,
      file: { ...file, storeKey: 'UNRESOLVED', branchId: null },
    });
    expect(result.rows).toEqual([]);
    expect(result.issues.map((i) => i.code)).toEqual([
      'UNRESOLVED_SOURCE_STORE',
      'UNRESOLVED_SALES_BRANCH',
    ]);
    expect(result.gross.detail?.lines).toBe(1);
  });

  it('uses the same private-safe worksheet identity as inspection through the Excel reader', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'synthetic-sales-'));
    try {
      const path = join(dir, 'fixture.xlsx');
      const book = new ExcelJS.Workbook();
      book.addWorksheet('Synthetic private name').addRows(detail);
      await book.xlsx.writeFile(path);
      const inspected = await inspectFiles([path]);
      const table = await readXlsxTable(path);
      const parsed = parseSalesReport(table.rows, {
        file: { ...file, sha256: inspected.files[0].sha256 },
        sheet: table.sheet,
      });
      expect(parsed.issues).toEqual([]);
      expect(parsed.rows[0].source.sheet).toBe(inspected.files[0].sheet);
      expect(JSON.stringify([inspected, parsed.rows[0].source])).not.toContain(
        'Synthetic private name',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('independent gross evidence', () => {
  it('reports the available sale price delta beside a malformed detail profit', () => {
    const bad = [...gift];
    bad[10] = '100';
    bad[11] = 'invalid';
    const result = parseSalesReport(
      [
        summary,
        ['ขายสินค้าทั้งหมด', '1', '1', '70.25', '0', '90', '19.75'],
        [],
        detail[0],
        HEADER,
        bad,
      ],
      context,
    );
    expect(result.rows).toEqual([]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_SALE_MONEY',
          message: expect.stringContaining('กำไร'),
          source: expect.objectContaining({ row: 6 }),
        }),
        expect.objectContaining({
          code: 'SALES_SUMMARY_MISMATCH',
          message: expect.stringContaining('ราคาขาย -10.00'),
          source: expect.objectContaining({ row: 2 }),
        }),
      ]),
    );
    expect(result.gross.detail).toEqual({
      bills: 1,
      lines: 1,
      costTotal: '70.25',
      listPrice: '0.00',
      salePrice: '100.00',
      profit: null,
    });
    expect(result.gross.delta).toEqual({
      bills: 0,
      lines: 0,
      costTotal: '0.00',
      listPrice: '0.00',
      salePrice: '-10.00',
      profit: null,
    });
  });

  it('keeps a verified physical item count and money when the bill identity is missing', () => {
    const bad = [...gift];
    bad[5] = '';
    const result = parseSalesReport(
      [summary, ['ขายสินค้าทั้งหมด', '1', '2', ...totals.slice(3)], [], detail[0], HEADER, bad],
      context,
    );
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MISSING_SOURCE_IDENTITY',
          source: expect.objectContaining({ row: 6 }),
        }),
        expect.objectContaining({
          code: 'SALES_SUMMARY_MISMATCH',
          source: expect.objectContaining({ row: 2 }),
        }),
      ]),
    );
    expect(result.gross.detail).toMatchObject({
      bills: null,
      lines: 1,
      costTotal: '70.25',
      profit: '-70.25',
    });
    expect(result.gross.delta).toMatchObject({
      bills: null,
      lines: 1,
      costTotal: '0.00',
      profit: '0.00',
    });
  });

  it('preserves valid reported fields when a different reported amount is malformed', () => {
    const result = parseSalesReport(
      [summary, ['ขายสินค้าทั้งหมด', '1', '1', '70.25', '0', '90', 'invalid'], [], ...detail],
      context,
    );
    expect(result.issues.map((i) => i.code)).toEqual([
      'INVALID_SALES_SUMMARY',
      'SALES_SUMMARY_MISMATCH',
    ]);
    expect(result.gross.reported).toMatchObject({ salePrice: '90.00', profit: null });
    expect(result.gross.delta).toMatchObject({ salePrice: '90.00', profit: null });
  });
});
