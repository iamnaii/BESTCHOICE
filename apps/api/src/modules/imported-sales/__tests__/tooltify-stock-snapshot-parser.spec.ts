import type { FileRef } from '../../../cli/tooltify-cutover/types';
import { parseSalesLineItems } from '../tooltify-sales-parser';
import { parseStockSnapshot } from '../tooltify-stock-snapshot-parser';

const HEADERS = [
  'บาร์โค้ดสินค้า',
  'ชื่อสินค้า',
  'หมวดหมู่สินค้า',
  'แหล่งที่มา',
  'รายละเอียดสินค้า',
  'เช็คสต๊อก',
  'วันที่นำเข้า',
  'ผู้นำเข้า',
  'ต้นทุนสินค้า',
  'No.',
];

const DEVICE = [
  '012345678901234',
  'iPhone 15 Pro 256GB (สีดำ)',
  'iPhone มือ 2 (เครื่องนอก)',
  'fixture-supplier',
  '',
  '0',
  '2026-11-21 00:05:01',
  'fixture-staff',
  '8000.25',
  '1',
];

const file: FileRef = {
  path: 'fixture.xlsx',
  sha256: 'a'.repeat(64),
  kind: 'STOCK_SNAPSHOT',
  storeKey: 'fixture-store',
  branchId: 'fixture-branch',
  reportFrom: '2026-11-21',
  reportTo: '2026-11-21',
};
const context = { file, sheet: 'Worksheet', canonicalSetId: 'fixture-cutover' };

function stockRows(...details: string[][]): string[][] {
  return [['ชื่อสินค้า', 'จำนวน'], ['iPhone 15 Pro', '1'], [], HEADERS, ...details];
}

describe('parseStockSnapshot', () => {
  it('carries battery health from the device detail row without inferring missing values', () => {
    const row = [...DEVICE];
    row[4] = 'แบตเตอรี่ : 81%\nดาวน์ 1,400 ผ่อน 1,249 x 10 ด';
    const parsed = parseStockSnapshot(stockRows(row), context);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ batteryHealth: 81, barcode: DEVICE[0] });
    expect(parseStockSnapshot(stockRows(DEVICE), context).rows[0]).not.toHaveProperty(
      'batteryHealth',
    );
  });

  it.each([
    '101%',
    '-1%',
    '81.5%',
    '81%\nแบตเตอรี่ : 90%',
    '81%\nแบตเตอรี่ : 90',
    '81%\nแบตเตอรี่ : ไม่ระบุ',
    'ไม่ระบุ',
  ])('blocks invalid or conflicting battery evidence %s', (value) => {
    const row = [...DEVICE];
    row[4] = 'แบตเตอรี่ : ' + value;
    const parsed = parseStockSnapshot(stockRows(row), context);
    expect(parsed.rows).toEqual([]);
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_BATTERY_HEALTH' }),
    );
  });

  it('preserves_device_identity_and_origin', () => {
    const snapshotRows = stockRows(DEVICE);
    const result = parseStockSnapshot(snapshotRows, context);
    expect(result.rows[0]).toMatchObject({
      barcode: '012345678901234',
      category: 'PHONE_USED',
      deviceOrigin: 'IMPORTED',
    });
    expect(result.issues).toEqual([]);
  });

  it('reads cost from the ninth column and leaves prices and statuses unresolved', () => {
    const result = parseStockSnapshot(stockRows(DEVICE), context);
    expect(result.issues).toEqual([]);
    expect(result.rows).toMatchObject([
      {
        kind: 'DEVICE',
        sourceKey: '55a7f214e9a0d7dec02b60904ea04505d9d8e4a05a66b4ca8a585b3e9e300958',
        name: 'iPhone 15 Pro 256GB (สีดำ)',
        brand: 'Apple',
        model: 'iPhone 15 Pro',
        storage: '256GB',
        color: 'สีดำ',
        cost: '8000.25',
        cashPrice: null,
        installmentPrice: null,
        financePrice: null,
        sourceStatus: null,
        desiredStatus: null,
        priceEvidence: null,
        branchId: 'fixture-branch',
        importedAt: '2026-11-20T17:05:01.000Z',
        source: {
          fileSha256: file.sha256,
          sheet: 'Worksheet',
          row: 5,
          storeKey: 'fixture-store',
        },
      },
    ]);
  });

  it('locates fields by heading when columns move', () => {
    const order = [8, 2, 6, 9, 5, 7, 4, 1, 0, 3];
    const result = parseStockSnapshot(
      [order.map((index) => HEADERS[index]), order.map((index) => DEVICE[index])],
      context,
    );
    expect(result.issues).toEqual([]);
    expect(result.rows).toMatchObject([{ barcode: '012345678901234', cost: '8000.25' }]);
  });

  it.each(['', 'ชื่อสินค้า'])(
    'reports a missing cost heading when replaced with %j',
    (replacement) => {
      const header = [...HEADERS];
      header[8] = replacement;
      const result = parseStockSnapshot([header, DEVICE], context);
      expect(result.rows).toEqual([]);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'UNRECOGNIZED_COLUMNS',
          source: expect.objectContaining({ row: 1 }),
          message: expect.stringContaining('ต้นทุนสินค้า'),
        }),
      );
    },
  );

  it('keeps physical row numbers and counts each accessory row once across a blank row', () => {
    const accessory = [
      'CASE-SKU',
      'เคส - iStar',
      'Accessories',
      '',
      '',
      '0',
      '2026-11-21 00:05:01',
      '',
      '35',
      '99',
    ];
    const result = parseStockSnapshot(stockRows(accessory, [], accessory, accessory), context);

    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => row.source.row)).toEqual([5, 7, 8]);
    expect(new Set(result.rows.map((row) => row.sourceKey)).size).toBe(3);
    expect(result.rows[0].sourceKey).toBe(
      '3a677819b8b736bb8ce19beb57cc9843a77c803199d84c5b908e8436d7fb045c',
    );
    expect(result.rows.every((row) => row.kind === 'ACCESSORY' && row.barcode === 'CASE-SKU')).toBe(
      true,
    );
  });

  it('rejects every occurrence of a repeated device IMEI and reports their Excel rows', () => {
    const result = parseStockSnapshot(stockRows(DEVICE, [], DEVICE), context);
    expect(result.rows).toEqual([]);
    expect(result.issues.map(({ code, source }) => [code, source?.row])).toEqual([
      ['DUPLICATE_IMEI', 5],
      ['DUPLICATE_IMEI', 7],
    ]);
  });

  it('keeps current device identity independent of branch, cutover set, and sales history', () => {
    const [pastSale] = parseSalesLineItems(
      [
        ['รายการขาย ( 1 )'],
        ['บาร์โค้ดสินค้า'],
        [
          DEVICE[0],
          DEVICE[1],
          DEVICE[2],
          '',
          '',
          'fixture-order',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '2026-10-20 12:00:00',
        ],
      ],
      { importBatch: 'fixture-october' },
    );
    const first = parseStockSnapshot(stockRows(DEVICE), context);
    const second = parseStockSnapshot(stockRows(DEVICE), {
      ...context,
      canonicalSetId: 'another-cutover',
      file: { ...file, branchId: 'another-branch' },
    });
    expect(first.issues).toEqual([]);
    expect(second.issues).toEqual([]);
    expect(first.rows[0].sourceKey).toBe(second.rows[0].sourceKey);
    expect(first.rows[0].barcode).toBe(pastSale.barcode);
  });

  it('reports invalid barcode in a device category', () => {
    const result = parseStockSnapshot(stockRows(['DEVICE-SKU', ...DEVICE.slice(1)]), context);
    expect(result.rows).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'INVALID_DEVICE_IMEI',
        source: expect.objectContaining({ row: 5 }),
      }),
    );
  });

  it.each(['', 'Unexpected category', 'Tablet service'])(
    'reports unknown category %j',
    (category) => {
      const row = [...DEVICE];
      row[2] = category;
      const result = parseStockSnapshot(stockRows(row), context);
      expect(result.rows).toEqual([]);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'UNKNOWN_SOURCE_CATEGORY' }),
      );
    },
  );

  it.each(['', 'NaN', 'Infinity', '-0.01', '1.001', '10000000000.00'])(
    'reports missing or invalid cost %j',
    (cost) => {
      const row = [...DEVICE];
      row[8] = cost;
      const result = parseStockSnapshot(stockRows(row), context);
      expect(result.rows).toEqual([]);
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_STOCK_COST' }));
    },
  );

  it.each([
    ['0', '0.00'],
    ['9,999,999,999.99', '9999999999.99'],
  ])('preserves exact valid cost %s', (cost, expected) => {
    const row = [...DEVICE];
    row[8] = cost;
    const result = parseStockSnapshot(stockRows(row), context);
    expect(result.issues).toEqual([]);
    expect(result.rows[0].cost).toBe(expected);
  });

  it('reports an impossible calendar date', () => {
    const row = [...DEVICE];
    row[6] = '2026-02-29 00:05:01';
    const result = parseStockSnapshot(stockRows(row), context);
    expect(result.rows).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_SOURCE_DATE' }));
  });

  it('reports a row without a resolved branch', () => {
    const result = parseStockSnapshot(stockRows(DEVICE), {
      ...context,
      file: { ...file, branchId: null },
    });
    expect(result.rows).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'UNRESOLVED_STOCK_BRANCH',
        source: expect.objectContaining({ row: 5 }),
      }),
    );
  });
});

it('accepts a blank-category tablet serial only with evidence for that exact source row and preserves the serial', () => {
  const row = [...DEVICE];
  row[0] = 'SYNTHETIC42'; row[1] = 'iPad Air 5'; row[2] = '';
  const decision = { action: 'MAP_STOCK_ITEM', fileSha256: file.sha256, sourceRows: [5],
    expectedBarcode: row[0], expectedName: row[1], expectedCategory: '', category: 'TABLET',
    reason: 'Checked tablet source record', evidenceRef: 'synthetic-source-record' };
  const result = parseStockSnapshot(stockRows(row), { ...context, decisions: [decision] } as any);
  expect(result.issues).toEqual([]);
  expect(result.rows[0]).toMatchObject({ barcode: 'SYNTHETIC42', category: 'TABLET', kind: 'DEVICE', sourceMapping: decision });
  expect(parseStockSnapshot(stockRows(row), context).rows).toEqual([]);
  expect(parseStockSnapshot(stockRows(row), { ...context, decisions: [{ ...decision, expectedBarcode: 'different' }] } as any).rows).toEqual([]);
});

it('maps a blank-category accessory without converting its leading-zero barcode to an IMEI', () => {
  const row = [...DEVICE]; row[0] = '000123456'; row[1] = 'Apple Pencil'; row[2] = '';
  const result = parseStockSnapshot(stockRows(row), { ...context, decisions: [{
    action: 'MAP_STOCK_ITEM', fileSha256: file.sha256, sourceRows: [5], expectedBarcode: row[0], expectedName: row[1], expectedCategory: '', category: 'ACCESSORY', reason: 'Checked accessory record', evidenceRef: 'synthetic-source-record',
  }] } as any);
  expect(result.issues).toEqual([]);
  expect(result.rows[0]).toMatchObject({ barcode: '000123456', category: 'ACCESSORY', kind: 'ACCESSORY' });
});
