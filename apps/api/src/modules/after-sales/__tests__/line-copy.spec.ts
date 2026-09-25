import {
  buildLineData,
  buildLiffLine,
  lineEventNote,
  lineEventTag,
  type AfterSalesLineMoment,
  type LineCaseRow,
} from '../utils/after-sales-line-copy.util';

// PR 3 Task 1 — ตัวประกอบข้อมูลข้อความ LINE หลังการขาย (pure util, ไม่แตะ DB/network)
// เลขตัวอักษร (a)-(g) อ้างอิงรายการเทสต์ใน brief Step 1

const baseRow: LineCaseRow = {
  caseNumber: 'AS-20260907-0004',
  outcome: 'REPAIR',
  symptom: 'เปิดไม่ติด ชาร์จไม่เข้า',
  deviceBrand: 'iPhone',
  deviceModel: '13',
  deviceStorage: '128GB',
  deviceImei: '356811111111111',
  branch: { name: 'สาขาลพบุรี' },
  warrantySnapshot: null,
  repairTicket: null,
  replacement: null,
  readyAt: null,
};

describe('lineEventTag', () => {
  it('คืน [eventType] เสมอ', () => {
    expect(lineEventTag('AFTER_SALES_READY')).toBe('[AFTER_SALES_READY]');
    expect(lineEventTag('WARRANTY_EXPIRING_7D')).toBe('[WARRANTY_EXPIRING_7D]');
  });
});

// (a)
describe('lineEventNote', () => {
  it('SENT', () => {
    expect(lineEventNote('AFTER_SALES_READY', 'SENT')).toBe(
      '[AFTER_SALES_READY] มารับได้แล้ว · ส่งแล้ว',
    );
  });

  it('NO_LINK', () => {
    expect(lineEventNote('AFTER_SALES_RECEIVED', 'NO_LINK')).toBe(
      '[AFTER_SALES_RECEIVED] รับเรื่องแล้ว · ไม่ได้ส่ง — ลูกค้ายังไม่ผูก LINE',
    );
  });

  it('FAILED พร้อม detail', () => {
    expect(lineEventNote('AFTER_SALES_CLOSED', 'FAILED', '429')).toBe(
      '[AFTER_SALES_CLOSED] ปิดเคส · ส่งไม่สำเร็จ (429)',
    );
  });

  it('DISABLED', () => {
    expect(lineEventNote('AFTER_SALES_PICKUP_REMINDER', 'DISABLED')).toBe(
      '[AFTER_SALES_PICKUP_REMINDER] เตือนรับเครื่อง 7 วัน · ไม่ได้ส่ง — ปิดการส่ง LINE (after_sales_line_enabled)',
    );
  });

  it('BLOCKED มี detail', () => {
    expect(lineEventNote('AFTER_SALES_CLOSED', 'BLOCKED', 'ลูกค้าบล็อกบัญชี')).toBe(
      '[AFTER_SALES_CLOSED] ปิดเคส · ไม่ได้ส่ง — ลูกค้าบล็อกบัญชี',
    );
  });

  it('BLOCKED ไม่มี detail ใช้ข้อความเริ่มต้น', () => {
    expect(lineEventNote('AFTER_SALES_CLOSED', 'BLOCKED')).toBe(
      '[AFTER_SALES_CLOSED] ปิดเคส · ไม่ได้ส่ง — ถูกบล็อก',
    );
  });

  it('event type ที่ไม่มีใน label map ใช้ตัวมันเองแทน label', () => {
    expect(lineEventNote('SOME_OTHER_EVENT', 'SENT')).toBe(
      '[SOME_OTHER_EVENT] SOME_OTHER_EVENT · ส่งแล้ว',
    );
  });
});

// (b)
describe('buildLiffLine', () => {
  it('มี liffId', () => {
    expect(buildLiffLine('123-abc', 'ดูสถานะเคส')).toBe(
      'ดูสถานะเคส: https://liff.line.me/123-abc/liff/warranty',
    );
  });

  it('ไม่มี liffId → คืนสตริงว่าง', () => {
    expect(buildLiffLine(null, 'x')).toBe('');
  });
});

// (c)
describe('buildLineData — RECEIVED', () => {
  it('REPAIR + IN_SHOP_WARRANTY + payer SHOP', () => {
    const row: LineCaseRow = {
      ...baseRow,
      outcome: 'REPAIR',
      warrantySnapshot: {
        status: 'IN_SHOP_WARRANTY',
        shopWarrantyEndDate: null,
        manufacturerWarrantyEndDate: null,
      },
      repairTicket: { payer: 'SHOP', estimatedCost: null, actualCost: null },
    };
    const data = buildLineData(row, 'RECEIVED', '');
    expect(data.entitlementLine).toBe('อยู่ในประกันร้าน ไม่มีค่าใช้จ่าย');
    expect(data.nextLine).toBe('ซ่อมเสร็จเมื่อไร ทางร้านจะแจ้งทาง LINE นี้ทันที');
  });

  it('REPAIR + OUT_OF_WARRANTY + payer CUSTOMER estimatedCost 1500', () => {
    const row: LineCaseRow = {
      ...baseRow,
      outcome: 'REPAIR',
      warrantySnapshot: {
        status: 'OUT_OF_WARRANTY',
        shopWarrantyEndDate: null,
        manufacturerWarrantyEndDate: null,
      },
      repairTicket: { payer: 'CUSTOMER', estimatedCost: '1500', actualCost: null },
    };
    const data = buildLineData(row, 'RECEIVED', '');
    expect(data.entitlementLine).toBe(
      'หมดประกัน ค่าซ่อมประมาณ 1,500 บาท ยืนยันราคาก่อนซ่อมทุกครั้ง',
    );
  });

  it('REPAIR + IN_MANUFACTURER + payer SUPPLIER_CLAIM', () => {
    const row: LineCaseRow = {
      ...baseRow,
      outcome: 'REPAIR',
      warrantySnapshot: {
        status: 'IN_MANUFACTURER',
        shopWarrantyEndDate: null,
        manufacturerWarrantyEndDate: null,
      },
      repairTicket: { payer: 'SUPPLIER_CLAIM', estimatedCost: null, actualCost: null },
    };
    const data = buildLineData(row, 'RECEIVED', '');
    expect(data.entitlementLine).toBe('อยู่ในประกันศูนย์ ส่งเคลมศูนย์ ไม่มีค่าใช้จ่าย');
  });

  it('SAME_MODEL_EXCHANGE', () => {
    const row: LineCaseRow = { ...baseRow, outcome: 'SAME_MODEL_EXCHANGE' };
    const data = buildLineData(row, 'RECEIVED', '');
    expect(data.entitlementLine).toBe('เปลี่ยนรุ่นเดิม รอผู้จัดการยืนยัน');
    expect(data.nextLine).toBe('เมื่อพร้อมรับเครื่อง ทางร้านจะแจ้งทาง LINE นี้ทันที');
  });

  it('PRICED_EXCHANGE', () => {
    const row: LineCaseRow = { ...baseRow, outcome: 'PRICED_EXCHANGE' };
    const data = buildLineData(row, 'RECEIVED', '');
    expect(data.entitlementLine).toBe('เปลี่ยนแบบมีราคา รออนุมัติ');
    expect(data.nextLine).toBe('เมื่อพร้อมรับเครื่อง ทางร้านจะแจ้งทาง LINE นี้ทันที');
  });
});

// (d)
describe('buildLineData — READY', () => {
  it('REPAIR + payer CUSTOMER actualCost 1500', () => {
    const row: LineCaseRow = {
      ...baseRow,
      outcome: 'REPAIR',
      repairTicket: { payer: 'CUSTOMER', estimatedCost: null, actualCost: '1500' },
    };
    const data = buildLineData(row, 'READY', '');
    expect(data.readyLine).toBe('ซ่อมเสร็จแล้ว มารับได้เลย');
    expect(data.costLine).toBe('ค่าซ่อม 1,500 บาท ชำระที่สาขา');
  });

  it('REPAIR + payer SHOP', () => {
    const row: LineCaseRow = {
      ...baseRow,
      outcome: 'REPAIR',
      repairTicket: { payer: 'SHOP', estimatedCost: null, actualCost: null },
    };
    const data = buildLineData(row, 'READY', '');
    expect(data.costLine).toBe('ไม่มี (ในประกันร้าน)');
  });

  it('SAME_MODEL_EXCHANGE', () => {
    const row: LineCaseRow = { ...baseRow, outcome: 'SAME_MODEL_EXCHANGE' };
    const data = buildLineData(row, 'READY', '');
    expect(data.readyLine).toBe('เปลี่ยนเครื่องใหม่ให้แล้ว มารับได้เลย');
    expect(data.costLine).toBe('ไม่มี');
  });

  it('PRICED_EXCHANGE', () => {
    const row: LineCaseRow = { ...baseRow, outcome: 'PRICED_EXCHANGE' };
    const data = buildLineData(row, 'READY', '');
    expect(data.readyLine).toBe('คำขอเปลี่ยนเครื่องอนุมัติแล้ว มาทำสัญญาใหม่ที่สาขาได้เลย');
  });
});

// (e)
describe('buildLineData — CLOSED', () => {
  it('REPAIR: deviceLine = deviceName, warrantyLines สองบรรทัด', () => {
    const row: LineCaseRow = {
      ...baseRow,
      outcome: 'REPAIR',
      warrantySnapshot: {
        status: 'IN_SHOP_WARRANTY',
        shopWarrantyEndDate: '2026-11-17T00:00:00.000Z',
        manufacturerWarrantyEndDate: '2027-03-01T00:00:00.000Z',
      },
    };
    const data = buildLineData(row, 'CLOSED', '');
    expect(data.deviceLine).toBe('iPhone 13 128GB');
    expect(data.warrantyLines).toBe('ประกันร้าน ถึง 17 พ.ย. 69\nประกันศูนย์ ถึง 1 มี.ค. 70');
  });

  it('REPAIR: มีแค่ประกันร้าน → ตัดบรรทัดประกันศูนย์ทิ้ง', () => {
    const row: LineCaseRow = {
      ...baseRow,
      outcome: 'REPAIR',
      warrantySnapshot: {
        status: 'IN_SHOP_WARRANTY',
        shopWarrantyEndDate: '2026-11-17T00:00:00.000Z',
        manufacturerWarrantyEndDate: null,
      },
    };
    const data = buildLineData(row, 'CLOSED', '');
    expect(data.warrantyLines).toBe('ประกันร้าน ถึง 17 พ.ย. 69');
  });

  it('REPAIR: ไม่มีวันหมดประกันเลย → "—"', () => {
    const row: LineCaseRow = { ...baseRow, outcome: 'REPAIR', warrantySnapshot: null };
    const data = buildLineData(row, 'CLOSED', '');
    expect(data.warrantyLines).toBe('—');
  });

  it('SAME_MODEL_EXCHANGE + newImei', () => {
    const row: LineCaseRow = {
      ...baseRow,
      outcome: 'SAME_MODEL_EXCHANGE',
      replacement: {
        brand: 'iPhone',
        model: '13',
        storage: '128GB',
        imeiSerial: '356812345678901',
        shopWarrantyEndDate: null,
      },
    };
    const data = buildLineData(row, 'CLOSED', '');
    expect(data.deviceLine).toBe('เครื่องใหม่ iPhone 13 128GB · IMEI 3568…');
    expect(data.warrantyLines.startsWith('ประกันนับใหม่จากวันส่งมอบ')).toBe(true);
  });
});

// (f)
describe('buildLineData — PICKUP_REMINDER', () => {
  it('REPAIR → readyKind = ซ่อมเสร็จ, readySince = thai date ของ readyAt', () => {
    const row: LineCaseRow = {
      ...baseRow,
      outcome: 'REPAIR',
      readyAt: new Date('2026-11-17T03:00:00.000Z'),
    };
    const data = buildLineData(row, 'PICKUP_REMINDER', '');
    expect(data.readyKind).toBe('ซ่อมเสร็จ');
    expect(data.readySince).toBe('17 พ.ย. 69');
  });

  it('SAME_MODEL_EXCHANGE → readyKind = พร้อมส่งมอบ', () => {
    const row: LineCaseRow = {
      ...baseRow,
      outcome: 'SAME_MODEL_EXCHANGE',
      readyAt: new Date('2026-11-17T03:00:00.000Z'),
    };
    const data = buildLineData(row, 'PICKUP_REMINDER', '');
    expect(data.readyKind).toBe('พร้อมส่งมอบ');
  });

  it('PRICED_EXCHANGE → readyKind = พร้อมส่งมอบ', () => {
    const row: LineCaseRow = {
      ...baseRow,
      outcome: 'PRICED_EXCHANGE',
      readyAt: new Date('2026-11-17T03:00:00.000Z'),
    };
    const data = buildLineData(row, 'PICKUP_REMINDER', '');
    expect(data.readyKind).toBe('พร้อมส่งมอบ');
  });
});

// (g)
describe('buildLineData — ทุก key เป็น string เสมอ ไม่มี undefined', () => {
  const moments: AfterSalesLineMoment[] = ['RECEIVED', 'READY', 'CLOSED', 'PICKUP_REMINDER'];

  const minimalRow: LineCaseRow = {
    caseNumber: 'AS-20260925-0002',
    outcome: null,
    symptom: 'จอแตก',
    deviceBrand: null,
    deviceModel: null,
    deviceStorage: null,
    deviceImei: null,
    branch: { name: 'สาขาทดสอบ' },
    warrantySnapshot: null,
    repairTicket: null,
    replacement: null,
    readyAt: null,
  };

  it('ทุก moment: ไม่มี key ใดเป็น undefined หรือสตริง "undefined"', () => {
    for (const moment of moments) {
      const data = buildLineData(minimalRow, moment, '');
      for (const [key, value] of Object.entries(data)) {
        expect(value).not.toBeUndefined();
        expect(typeof value).toBe('string');
        expect(value).not.toBe('undefined');
        // ป้ายกำกับ key ในข้อความ error หากล้ม
        if (typeof value !== 'string') throw new Error(`key ${key} ไม่ใช่ string`);
      }
    }
  });

  it('CASH_SAME_MODEL_EXCHANGE ก็ไม่มี key ใดเป็น undefined (ครบทุกค่าใน union ของ outcome)', () => {
    const row: LineCaseRow = { ...minimalRow, outcome: 'CASH_SAME_MODEL_EXCHANGE' };
    for (const moment of moments) {
      const data = buildLineData(row, moment, '');
      for (const value of Object.values(data)) {
        expect(typeof value).toBe('string');
        expect(value).not.toBe('undefined');
      }
    }
  });

  it('deviceName = "<brand> <model>" + storage ถ้ามี', () => {
    const row: LineCaseRow = {
      ...baseRow,
      deviceBrand: 'iPhone',
      deviceModel: '13',
      deviceStorage: '128GB',
    };
    expect(buildLineData(row, 'RECEIVED', '').deviceName).toBe('iPhone 13 128GB');

    const rowNoStorage: LineCaseRow = {
      ...baseRow,
      deviceBrand: 'iPhone',
      deviceModel: '13',
      deviceStorage: null,
    };
    expect(buildLineData(rowNoStorage, 'RECEIVED', '').deviceName).toBe('iPhone 13');
  });

  it('deviceName = "เครื่องของคุณ" เมื่อไม่มีข้อมูลเครื่องเลย', () => {
    expect(buildLineData(minimalRow, 'RECEIVED', '').deviceName).toBe('เครื่องของคุณ');
  });

  it('symptom ตัดที่ 120 ตัวอักษร + "…"', () => {
    const longSymptom = 'ก'.repeat(130);
    const row: LineCaseRow = { ...baseRow, symptom: longSymptom };
    const data = buildLineData(row, 'RECEIVED', '');
    expect(data.symptom).toBe(`${'ก'.repeat(120)}…`);
    expect(data.symptom.length).toBe(121);
  });

  it('symptom สั้นกว่า 120 ตัวอักษร ไม่ถูกตัด', () => {
    const row: LineCaseRow = { ...baseRow, symptom: 'จอแตก' };
    expect(buildLineData(row, 'RECEIVED', '').symptom).toBe('จอแตก');
  });

  it('liffLine ที่ส่งเข้ามาถูกส่งผ่านออกไปตรงๆ', () => {
    const data = buildLineData(
      baseRow,
      'RECEIVED',
      'ดูสถานะเคส: https://liff.line.me/x/liff/warranty',
    );
    expect(data.liffLine).toBe('ดูสถานะเคส: https://liff.line.me/x/liff/warranty');
  });
});
