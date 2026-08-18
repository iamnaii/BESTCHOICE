import {
  parseStockImportRows,
  isImeiBarcode,
  mapStockCategory,
  parseBatteryHealth,
  deriveBrandModel,
  reconstructCurrentStock,
  toProductCreateData,
  buildLegacyProductCode,
  ParsedStockImportRow,
} from '../tooltify-stock-parser';

// ---------------------------------------------------------------------------
// isImeiBarcode
// ---------------------------------------------------------------------------
describe('isImeiBarcode', () => {
  it('accepts 14 and 15 all-numeric digits', () => {
    expect(isImeiBarcode('35996714805934')).toBe(true); // 14
    expect(isImeiBarcode('355225772662858')).toBe(true); // 15
  });
  it('rejects alphanumeric / other lengths (accessory SKUs, iPad serials)', () => {
    expect(isImeiBarcode('CCCT01')).toBe(false);
    expect(isImeiBarcode('GRQHFNXGVJ')).toBe(false); // iPad alphanumeric serial
    expect(isImeiBarcode('195950086522')).toBe(false); // 12-digit iPad serial
    expect(isImeiBarcode('GIFT500')).toBe(false);
    expect(isImeiBarcode('')).toBe(false);
  });
  it('trims surrounding whitespace before testing', () => {
    expect(isImeiBarcode('355225772662858 ')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mapStockCategory
// ---------------------------------------------------------------------------
describe('mapStockCategory', () => {
  it('maps known Thai category text to ProductCategory', () => {
    expect(mapStockCategory('iPhone มือ 1')).toBe('PHONE_NEW');
    expect(mapStockCategory('iPhone มือ 2')).toBe('PHONE_USED');
    expect(mapStockCategory('iPad มือ 1')).toBe('TABLET');
    expect(mapStockCategory('Accessories')).toBe('ACCESSORY');
  });
  it('empty category (e.g. GIFT500 rows) falls back to ACCESSORY', () => {
    expect(mapStockCategory('')).toBe('ACCESSORY');
  });
  it('unrecognized category text falls back to ACCESSORY (safe default)', () => {
    expect(mapStockCategory('some future category')).toBe('ACCESSORY');
  });
});

// ---------------------------------------------------------------------------
// parseBatteryHealth
// ---------------------------------------------------------------------------
describe('parseBatteryHealth', () => {
  it('parses "% แบตเตอรี่ : NN%" out of a multiline details blob', () => {
    const details = '% แบตเตอรี่ : 84%\nดาวน์ 3900  ผ่อน 3137 x 12 ด\nดาวน์ 4900  ผ่อน 3864 x 12 ด';
    expect(parseBatteryHealth(details)).toBe(84);
  });
  it('parses a 100% value', () => {
    expect(parseBatteryHealth('% แบตเตอรี่ : 100%\nดาวน์ ...')).toBe(100);
  });
  it('returns null when absent (accessory details, no battery line)', () => {
    expect(parseBatteryHealth('ดาวน์ 3500  ผ่อน 2766 x 12 ด')).toBeNull();
    expect(parseBatteryHealth('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deriveBrandModel
// ---------------------------------------------------------------------------
describe('deriveBrandModel', () => {
  it('parses a phone name into brand/model/storage/color', () => {
    const r = deriveBrandModel('iPhone 16 128GB White (สีขาว)', 'PHONE_NEW');
    expect(r).toEqual({ brand: 'Apple', model: 'iPhone 16', storage: '128GB', color: 'สีขาว' });
  });
  it('handles "Pro Max" style names and Titanium colors', () => {
    const r = deriveBrandModel('iPhone 15 Pro Max 256GB White Titanium (สีขาว)', 'PHONE_USED');
    expect(r.brand).toBe('Apple');
    expect(r.model).toBe('iPhone 15 Pro Max');
    expect(r.storage).toBe('256GB');
    expect(r.color).toBe('สีขาว');
  });
  it('treats iPad names as Apple too (TABLET category)', () => {
    const r = deriveBrandModel('iPad 11 Wifi 128GB Blue (สีฟ้า)', 'TABLET');
    expect(r.brand).toBe('Apple');
    expect(r.storage).toBe('128GB');
  });
  it('handles lowercase-unit storage tokens ("128 Gb")', () => {
    const r = deriveBrandModel('iPad Gen 11 WiFi 128 Gb สีเงิน', 'TABLET');
    expect(r.storage).toBe('128GB');
  });
  it('phone name with no storage/color token still gets a non-empty model (no cut point)', () => {
    const r = deriveBrandModel('iPad 11 Wifi', 'TABLET');
    expect(r.brand).toBe('Apple');
    expect(r.model).toBe('iPad 11 Wifi');
    expect(r.storage).toBeNull();
    expect(r.color).toBeNull();
  });
  it('non-Apple phone name uses the first word as brand', () => {
    const r = deriveBrandModel('Samsung Galaxy S24 256GB Black', 'PHONE_USED');
    expect(r.brand).toBe('Samsung');
  });
  it('parses accessory name: vendor after the last " - "', () => {
    const r = deriveBrandModel('ชุดชาร์จ Type C to Type C - iStar', 'ACCESSORY');
    expect(r).toEqual({ brand: 'iStar', model: 'ชุดชาร์จ Type C to Type C - iStar', storage: null, color: null });
  });
  it('accessory name with no vendor separator falls back to brand "-"', () => {
    const r = deriveBrandModel('ส่วนลดเงินดาวน์ 500', 'ACCESSORY');
    expect(r.brand).toBe('-');
    expect(r.model).toBe('ส่วนลดเงินดาวน์ 500');
  });
  it('FALLBACK: empty name -> brand=Unknown, model=name (never null)', () => {
    expect(deriveBrandModel('', 'PHONE_NEW')).toEqual({
      brand: 'Unknown',
      model: '',
      storage: null,
      color: null,
    });
    expect(deriveBrandModel('   ', 'ACCESSORY')).toEqual({
      brand: 'Unknown',
      model: '',
      storage: null,
      color: null,
    });
  });
});

// ---------------------------------------------------------------------------
// parseStockImportRows
// ---------------------------------------------------------------------------
describe('parseStockImportRows', () => {
  const HEADER = [
    'บาร์โค้ดสินค้า', 'ชื่อสินค้า', 'หมวดหมู่สินค้า', 'ต้นทุนสินค้า', 'ราคาปลีก',
    'ราคา 2', 'ราคา 3', 'ราคา 4', 'ราคาเบิกซ่อม', 'แหล่งที่มา',
    'รายละเอียดสินค้า', 'วันที่นำเข้า', 'ผู้นำเข้า',
  ];

  function mkRows(): string[][] {
    return [
      ['สรุปยอดการนำเข้า 2026-01-01 ถึง 2026-03-31'],
      [],
      ['นำเข้าข้อมูลทั้งหมด', 'นำเข้าข้อมูลทั้งหมด', '2', 'รายการ'],
      ['ราคาปลีก', 'ราคาปลีก', '100', 'บาท'],
      ['ราคา 3', 'ราคา 3', '100', 'บาท'],
      ['ราคาเบิกซ่อม', 'ราคาเบิกซ่อม', '0', 'บาท'],
      [],
      [],
      HEADER,
      [
        '355225772662858 ', 'iPhone 15 128GB Pink (สีชมพู)', 'iPhone มือ 1', '20900', '24100',
        '24840', '25445', '0', '0', 'LAZADA', 'ดาวน์ 3500  ผ่อน 2766 x 12 ด', '2026-03-31 17:06:46',
        'ประภานิช',
      ],
      [
        'CCCT01', 'ที่ชาร์จ - iStar', 'Accessories', '35', '99', '109', '0', '0', '0', 'LAZADA',
        '', '2026-03-30 10:00:00', 'หมวย',
      ],
      [], // blank row terminates the table
      ['ignored trailing row'],
    ];
  }

  it('locates the detail header (col0 === บาร์โค้ดสินค้า) and reads until a blank row', () => {
    const out = parseStockImportRows(mkRows(), { importBatch: 'file-A.xlsx' });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject<Partial<ParsedStockImportRow>>({
      barcode: '355225772662858',
      name: 'iPhone 15 128GB Pink (สีชมพู)',
      categoryText: 'iPhone มือ 1',
      cost: '20900',
      cashPrice: '24100',
      installmentPrice: '24840',
      importDate: '2026-03-31 17:06:46',
      importBatch: 'file-A.xlsx',
    });
    expect(out[1].barcode).toBe('CCCT01');
  });

  it('returns [] when no detail header is present', () => {
    expect(parseStockImportRows([['x'], ['y']], { importBatch: 'f' })).toEqual([]);
  });

  it('skips rows with an empty barcode (blank terminator)', () => {
    const rows = [HEADER, ['', 'x', 'y']];
    expect(parseStockImportRows(rows, { importBatch: 'f' })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// reconstructCurrentStock
// ---------------------------------------------------------------------------
describe('reconstructCurrentStock', () => {
  function mkRow(over: Partial<ParsedStockImportRow>): ParsedStockImportRow {
    return {
      barcode: '000000000000000',
      name: 'iPhone 15 128GB Pink (สีชมพู)',
      categoryText: 'iPhone มือ 2',
      cost: '20000',
      cashPrice: '24000',
      installmentPrice: '25000',
      details: '',
      importDate: '2026-01-01 10:00:00',
      importBatch: 'f1.xlsx',
      ...over,
    };
  }

  it('phones not in the sold set remain in stock; sold phones are excluded', () => {
    const imports = [
      mkRow({ barcode: '111111111111111' }), // not sold -> remains
      mkRow({ barcode: '222222222222222' }), // sold -> excluded
    ];
    const sold = ['222222222222222'];
    const { phones } = reconstructCurrentStock(imports, sold);
    expect(phones.map((p) => p.barcode)).toEqual(['111111111111111']);
  });

  it('dedups a phone imported twice — the LATEST import record wins', () => {
    const imports = [
      mkRow({ barcode: '111111111111111', importDate: '2026-01-01 10:00:00', cost: '18000' }),
      mkRow({ barcode: '111111111111111', importDate: '2026-03-31 09:00:00', cost: '20500' }),
    ];
    const { phones } = reconstructCurrentStock(imports, []);
    expect(phones).toHaveLength(1);
    expect(phones[0].cost).toBe('20500');
    expect(phones[0].importDate).toBe('2026-03-31 09:00:00');
  });

  it('accessory qty = timesImported - timesSold, clamped >= 0', () => {
    const imports = [
      mkRow({ barcode: 'CCCT01', categoryText: 'Accessories' }),
      mkRow({ barcode: 'CCCT01', categoryText: 'Accessories' }),
      mkRow({ barcode: 'CCCT01', categoryText: 'Accessories' }),
      mkRow({ barcode: 'F14PM01', categoryText: 'Accessories' }),
    ];
    // CCCT01 imported 3x, sold 1x -> qty 2. F14PM01 imported 1x, sold 2x (oversold) -> clamp 0 (dropped).
    const sold = ['CCCT01', 'F14PM01', 'F14PM01'];
    const { accessories } = reconstructCurrentStock(imports, sold);
    expect(accessories).toHaveLength(1);
    expect(accessories[0]).toMatchObject({ sku: 'CCCT01', qty: 2 });
  });

  it('excludes GIFT500 entirely, even though it is imported and would otherwise have positive qty', () => {
    const imports = [
      mkRow({ barcode: 'GIFT500', categoryText: '' }),
      mkRow({ barcode: 'GIFT500', categoryText: '' }),
    ];
    const { accessories } = reconstructCurrentStock(imports, []);
    expect(accessories).toEqual([]);
  });

  it('a normal SKU literally named GIFT500 stays excluded even with a custom excludeSkus override applied elsewhere (default list)', () => {
    const imports = [mkRow({ barcode: 'GIFT500', categoryText: '' })];
    const { accessories } = reconstructCurrentStock(imports, [], { excludeSkus: ['GIFT500'] });
    expect(accessories).toEqual([]);
  });

  it('end-to-end shape: mixed phones + accessories reconstruct independently', () => {
    const imports = [
      mkRow({ barcode: '111111111111111', categoryText: 'iPhone มือ 1' }),
      mkRow({ barcode: 'CCCT01', categoryText: 'Accessories' }),
      mkRow({ barcode: 'GIFT500', categoryText: '' }),
    ];
    const { phones, accessories } = reconstructCurrentStock(imports, []);
    expect(phones).toHaveLength(1);
    expect(accessories).toHaveLength(1);
    expect(accessories[0].sku).toBe('CCCT01');
  });
});

// ---------------------------------------------------------------------------
// buildLegacyProductCode + toProductCreateData
// ---------------------------------------------------------------------------
describe('buildLegacyProductCode', () => {
  it('phone: TTFY-<IMEI>', () => {
    expect(buildLegacyProductCode({ kind: 'phone', barcode: '355225772662858' })).toBe(
      'TTFY-355225772662858',
    );
  });
  it('accessory: TTFY-<SKU>-<seq>', () => {
    expect(buildLegacyProductCode({ kind: 'accessory', sku: 'CCCT01', seq: 3 })).toBe('TTFY-CCCT01-3');
  });
});

describe('toProductCreateData', () => {
  const ctx = { branchId: 'branch-001', ownedByCompanyId: 'company-shop' };

  it('builds a phone Product row: imeiSerial set, accessoryType null, battery parsed, IN_STOCK', () => {
    const row: ParsedStockImportRow = {
      barcode: '355225772662858',
      name: 'iPhone 15 Pro Max 256GB White Titanium (สีขาว)',
      categoryText: 'iPhone มือ 2',
      cost: '24900',
      cashPrice: '26900',
      installmentPrice: '29200',
      details: '% แบตเตอรี่ : 84%\nดาวน์ 3900  ผ่อน 3137 x 12 ด',
      importDate: '2026-03-31 14:27:11',
      importBatch: 'f.xlsx',
    };
    const out = toProductCreateData(row, ctx, {
      kind: 'phone',
      legacyProductCode: buildLegacyProductCode({ kind: 'phone', barcode: row.barcode }),
    });
    expect(out).toMatchObject({
      name: row.name,
      brand: 'Apple',
      model: 'iPhone 15 Pro Max',
      storage: '256GB',
      color: 'สีขาว',
      imeiSerial: '355225772662858',
      accessoryType: null,
      accessoryBrand: null,
      category: 'PHONE_USED',
      costPrice: '24900',
      cashPrice: '26900',
      installmentPrice: '29200',
      branchId: 'branch-001',
      ownedByCompanyId: 'company-shop',
      status: 'IN_STOCK',
      batteryHealth: 84,
      legacyProductCode: 'TTFY-355225772662858',
    });
    expect(out.stockInDate.toISOString()).toBe('2026-03-31T07:27:11.000Z'); // BKK -07:00
  });

  it('builds an accessory Product row: accessoryType set, imeiSerial null, batteryHealth null', () => {
    const row: ParsedStockImportRow = {
      barcode: 'CCCT01',
      name: 'ชุดชาร์จ Type C to Type C - iStar',
      categoryText: 'Accessories',
      cost: '35',
      cashPrice: '99',
      installmentPrice: '109',
      details: '',
      importDate: '2026-03-30 10:00:00',
      importBatch: 'f.xlsx',
    };
    const out = toProductCreateData(row, ctx, {
      kind: 'accessory',
      legacyProductCode: buildLegacyProductCode({ kind: 'accessory', sku: row.barcode, seq: 1 }),
    });
    expect(out).toMatchObject({
      brand: 'iStar',
      model: 'ชุดชาร์จ Type C to Type C - iStar',
      imeiSerial: null,
      accessoryType: 'CCCT01',
      accessoryBrand: 'iStar',
      category: 'ACCESSORY',
      batteryHealth: null,
      legacyProductCode: 'TTFY-CCCT01-1',
    });
  });

  it('sanitizes a negative/malformed money field to "0"', () => {
    const row: ParsedStockImportRow = {
      barcode: 'X1',
      name: 'ของแถม',
      categoryText: 'Accessories',
      cost: '-5',
      cashPrice: 'not-a-number',
      installmentPrice: '10',
      details: '',
      importDate: '2026-01-01 00:00:00',
      importBatch: 'f.xlsx',
    };
    const out = toProductCreateData(row, ctx, { kind: 'accessory', legacyProductCode: 'TTFY-X1-1' });
    expect(out.costPrice).toBe('0');
    expect(out.cashPrice).toBe('0');
    expect(out.installmentPrice).toBe('10');
  });

  it('accessory with no vendor in the name gets accessoryBrand=null (brand "-" is not a real brand)', () => {
    const row: ParsedStockImportRow = {
      barcode: 'DISC1',
      name: 'ส่วนลดลูกค้าต่างจังหวัด',
      categoryText: 'Accessories',
      cost: '0',
      cashPrice: '0',
      installmentPrice: '0',
      details: '',
      importDate: '2026-01-01 00:00:00',
      importBatch: 'f.xlsx',
    };
    const out = toProductCreateData(row, ctx, { kind: 'accessory', legacyProductCode: 'TTFY-DISC1-1' });
    expect(out.brand).toBe('-');
    expect(out.accessoryBrand).toBeNull();
  });
});
