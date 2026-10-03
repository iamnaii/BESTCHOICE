import {
  composeHandoverDoc,
  composeReceiptDoc,
  handoverBlockReason,
  HANDOVER_CASH_UNSUPPORTED_MSG,
  HANDOVER_NOT_READY_MSG,
  OTHER_MAX,
  RECEIPT_CONDITIONS,
  SYMPTOM_MAX,
  type DocSource,
} from '../documents/after-sales-doc-compose';
import {
  buildAfterSalesDocHtml,
  type AfterSalesDoc,
  type DocBlock,
} from '../documents/after-sales-doc-html';
import { PRICED_EXCHANGE_COST_LINE } from '../utils/after-sales-line-copy.util';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function source(over: Partial<DocSource> = {}): DocSource {
  return {
    company: {
      nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด',
      address: 'ลพบุรี',
      taxId: '0165568000050',
      phone: null,
    },
    caseNumber: 'AS-20260907-0004',
    branchName: 'ลพบุรี',
    receivedAt: new Date('2026-09-07T03:12:00.000Z'), // 10:12 น. เวลาไทย
    receivedByName: 'สุดา',
    printedAt: new Date('2026-09-26T08:41:00.000Z'), // 15:41 น.
    printedByName: 'นิภา',
    customerName: 'สมชาย ใจดี',
    customerPhone: '0812344412',
    lineLinked: true,
    source: 'INSTALLMENT_CONTRACT',
    contractNumber: 'CT-2026-0912',
    saleNumber: null,
    deviceLabel: 'Apple iPhone 13 128GB · ดำ · มือสอง',
    deviceImei: '356812345674412',
    deviceSerial: 'F2LXK3P09Q',
    accessories: { box: true, charger: true, case: false, other: null },
    unlockConfirmed: true,
    symptom: 'เปิดไม่ติด ชาร์จไม่เข้า',
    photoCount: 3,
    photos: [PNG, PNG, PNG],
    warranty: {
      purchasedAt: new Date('2026-08-19T05:00:00.000Z'),
      shopWarrantyEnd: new Date('2026-11-17T00:00:00.000Z'),
      manufacturerWarrantyEnd: new Date('2027-09-17T00:00:00.000Z'),
      within7Days: false,
    },
    outcome: 'REPAIR',
    stage: 'RECEIVED',
    closedAt: null,
    repair: {
      payer: 'SHOP',
      estimatedCost: null,
      actualCost: null,
      supplierName: null,
      externalClaimNo: null,
      sentToRepairAt: null,
      repairedAt: null,
      returnedToCustomerAt: null,
    },
    exchange: null,
    ...over,
  };
}

function rows(doc: AfterSalesDoc) {
  return doc.blocks.flatMap((b) =>
    b.type === 'pair'
      ? [...b.left.rows, ...b.right.rows]
      : b.type === 'section'
        ? b.section.rows
        : [],
  );
}
const rowOf = (doc: AfterSalesDoc, label: string) => rows(doc).find((r) => r.label === label);
const valueOf = (doc: AfterSalesDoc, label: string) => rowOf(doc, label)?.value;
const block = <T extends DocBlock['type']>(doc: AfterSalesDoc, type: T) =>
  doc.blocks.find((b): b is Extract<DocBlock, { type: T }> => b.type === type);

describe('composeReceiptDoc — ใบรับฝากเครื่อง', () => {
  it('(a) สัญญาผ่อน ร้านจ่าย: หัว/ที่มา/สิทธิ์/ทางออก/เงื่อนไข/ลายเซ็น ครบตามกระดาน 8', () => {
    const doc = composeReceiptDoc(source());
    expect(doc.title).toBe('ใบรับฝากเครื่อง');
    expect(doc.kicker).toBe('ต้นฉบับ — ร้านเก็บ (ลูกค้าเซ็น)');
    expect(doc.meta).toEqual([
      { label: 'เลขเคส', value: 'AS-20260907-0004' },
      { label: 'วันที่รับฝาก', value: '7 ก.ย. 2569 · 10:12 น.' },
      { label: 'สาขา', value: 'ลพบุรี' },
      { label: 'พนักงาน', value: 'สุดา' },
    ]);
    expect(valueOf(doc, 'ชื่อ')).toBe('สมชาย ใจดี');
    expect(valueOf(doc, 'แจ้งสถานะ')).toBe('ทาง LINE (ผูกไว้แล้ว)');
    expect(valueOf(doc, 'ซื้อแบบ')).toBe('สัญญาผ่อน CT-2026-0912');
    expect(valueOf(doc, 'วันที่ซื้อ')).toBe('19 ส.ค. 2569');
    expect(valueOf(doc, 'ประกันร้าน')).toBe('ถึง 17 พ.ย. 2569');
    expect(valueOf(doc, 'ประกันศูนย์')).toBe('ถึง 17 ก.ย. 2570');
    expect(valueOf(doc, 'กรอบ 7 วัน')).toBe('เลยแล้ว');
    expect(valueOf(doc, 'ทางออก')).toBe('ซ่อม');
    expect(valueOf(doc, 'ผู้จ่ายค่าซ่อม')).toBe('ร้าน');
    expect(valueOf(doc, 'ลูกค้าจ่าย')).toBe('ไม่มี');
    expect(block(doc, 'table')?.rows).toEqual([
      ['Apple iPhone 13 128GB · ดำ · มือสอง', '356812345674412', 'F2LXK3P09Q'],
    ]);
    // I4 — IMEI/Serial ห้ามตัดกลางเลข
    expect(block(doc, 'table')?.nowrapCols).toEqual([1, 2]);
    expect(doc.conditions).toEqual({
      title: 'เงื่อนไขการรับฝาก',
      items: [...RECEIPT_CONDITIONS],
    });
    expect(doc.signatures[0]).toEqual({
      role: 'ลูกค้า (ผู้ฝาก)',
      name: 'สมชาย ใจดี',
      sub: 'วันที่ ........ / ........ / ........',
    });
    expect(doc.signatures[1]).toEqual({
      role: 'พนักงาน',
      name: 'สุดา',
      sub: 'ลพบุรี · 7 ก.ย. 2569',
    });
    expect(doc.footer).toBe(
      'หลังการขาย · เคส AS-20260907-0004 · พิมพ์ 26 ก.ย. 2569 15:41 น. โดย นิภา',
    );
  });

  it('(b) ลูกค้าจ่าย มี/ไม่มีราคาประมาณ · ไม่ผูก LINE', () => {
    const repair = { ...source().repair!, payer: 'CUSTOMER' as const };
    expect(
      valueOf(
        composeReceiptDoc(source({ repair: { ...repair, estimatedCost: '1500.5' } })),
        'ลูกค้าจ่าย',
      ),
    ).toBe('ประมาณ 1,500.50 บาท — แจ้งให้ยืนยันก่อนซ่อม');
    const noEstimate = composeReceiptDoc(source({ repair, lineLinked: false }));
    expect(valueOf(noEstimate, 'ลูกค้าจ่าย')).toBe('ร้านจะแจ้งราคาให้ยืนยันก่อนซ่อม');
    expect(valueOf(noEstimate, 'ผู้จ่ายค่าซ่อม')).toBe('ลูกค้า');
    expect(valueOf(noEstimate, 'แจ้งสถานะ')).toBe('โทรแจ้ง (ยังไม่ผูก LINE)');
  });

  it('(c) เปลี่ยนแบบมีราคา / เปลี่ยนรุ่นเดิม / ยังไม่เลือกทางออก', () => {
    const priced = composeReceiptDoc(source({ outcome: 'PRICED_EXCHANGE', repair: null }));
    expect(valueOf(priced, 'ทางออก')).toBe('เปลี่ยนแบบมีราคา');
    expect(valueOf(priced, 'ผู้จ่ายค่าซ่อม')).toBeUndefined();
    expect(valueOf(priced, 'ลูกค้าจ่าย')).toBe(PRICED_EXCHANGE_COST_LINE);
    const same = composeReceiptDoc(source({ outcome: 'SAME_MODEL_EXCHANGE', repair: null }));
    expect(valueOf(same, 'ทางออก')).toBe('เปลี่ยนรุ่นเดิม');
    expect(valueOf(same, 'ลูกค้าจ่าย')).toBe('ไม่มี');
    const none = composeReceiptDoc(source({ outcome: null, repair: null }));
    expect(valueOf(none, 'ทางออก')).toBe('ยังไม่ได้เลือก');
    expect(valueOf(none, 'ลูกค้าจ่าย')).toBe('—');
  });

  it('(d) walk-in / ขายสด: ที่มาและสิทธิ์', () => {
    const walkIn = composeReceiptDoc(
      source({
        source: 'WALK_IN',
        contractNumber: null,
        warranty: {
          purchasedAt: null,
          shopWarrantyEnd: null,
          manufacturerWarrantyEnd: null,
          within7Days: false,
        },
      }),
    );
    expect(valueOf(walkIn, 'ซื้อแบบ')).toBe('ไม่ได้ซื้อจากร้าน');
    expect(valueOf(walkIn, 'วันที่ซื้อ')).toBe('—');
    expect(valueOf(walkIn, 'สถานะ')).toBe('ไม่ได้ซื้อจากร้าน — ไม่มีประกันร้าน');
    expect(valueOf(walkIn, 'ประกันร้าน')).toBeUndefined();
    const cash = composeReceiptDoc(
      source({ source: 'CASH_SALE', contractNumber: null, saleNumber: 'SL-20260819-0003' }),
    );
    expect(valueOf(cash, 'ซื้อแบบ')).toBe('ขายสด / ไฟแนนซ์นอก SL-20260819-0003');
  });

  it('(e) อาการยาวเกิน 300 / "อื่น ๆ" ยาวเกิน 60 → ตัดพร้อมบอกว่าเต็มอยู่ในระบบ', () => {
    const doc = composeReceiptDoc(
      source({
        symptom: 'ก'.repeat(400),
        accessories: { box: false, charger: false, case: false, other: 'ข'.repeat(100) },
      }),
    );
    expect(block(doc, 'box')?.text).toBe(`${'ก'.repeat(SYMPTOM_MAX)}… (ข้อความเต็มในระบบ)`);
    const checks = block(doc, 'checks')!;
    expect(checks.items[3]).toEqual({
      text: `อื่น ๆ — ${'ข'.repeat(OTHER_MAX)}… (ข้อความเต็มในระบบ)`,
      checked: true,
    });
    expect(checks.trailing).toEqual({ text: 'ลูกค้าปิด Find My / ออกจากบัญชีแล้ว', checked: true });
  });

  it('(f) รูป: 6 ช่องตามมุม · ช่องที่มีรูปแต่อ่านไม่ได้ = "เปิดรูปไม่ได้" · ช่องเกินจำนวน = "ไม่ได้ถ่าย"', () => {
    const doc = composeReceiptDoc(source({ photoCount: 3, photos: [PNG, null, PNG] }));
    const photos = block(doc, 'photos')!;
    expect(photos.title).toBe('สภาพเครื่องตอนรับฝาก (รูปถ่าย 3 มุม — รูปเต็มอยู่ในระบบ)');
    // emptyText ของช่องที่ "ควรมีรูป" (i < photoCount) = "เปิดรูปไม่ได้" เสมอ — builder ใช้เฉพาะเมื่อรูปใช้ไม่ได้
    expect(photos.photos.map((p) => [p.angle, !!p.dataUrl, p.emptyText])).toEqual([
      ['หน้า', true, 'เปิดรูปไม่ได้'],
      ['หลัง', false, 'เปิดรูปไม่ได้'],
      ['ซ้าย', true, 'เปิดรูปไม่ได้'],
      ['ขวา', false, 'ไม่ได้ถ่าย'],
      ['บน', false, 'ไม่ได้ถ่าย'],
      ['ล่าง', false, 'ไม่ได้ถ่าย'],
    ]);
    expect(block(composeReceiptDoc(source({ photoCount: 0, photos: [] })), 'photos')!.title).toBe(
      'สภาพเครื่องตอนรับฝาก (ไม่ได้ถ่ายรูป)',
    );
  });
});

describe('composeHandoverDoc — ใบส่งมอบ', () => {
  const readyRepair = (over: Partial<NonNullable<DocSource['repair']>> = {}) =>
    source({
      stage: 'READY_FOR_PICKUP',
      repair: {
        payer: 'SHOP',
        estimatedCost: null,
        actualCost: '1500.00',
        supplierName: 'iCare ลพบุรี',
        externalClaimNo: 'IC-77821',
        sentToRepairAt: new Date('2026-09-08T07:00:00.000Z'),
        repairedAt: new Date('2026-09-25T04:00:00.000Z'),
        returnedToCustomerAt: null,
        ...over,
      },
    });

  it('(g) หลังซ่อม ร้านจ่าย: kicker/meta/ผลการซ่อม/ค่าใช้จ่าย/ประกัน/ack/ลายเซ็น — ยังไม่ส่งมอบ = วันที่พิมพ์', () => {
    const doc = composeHandoverDoc(readyRepair());
    expect(doc.title).toBe('ใบส่งมอบ');
    expect(doc.kicker).toBe('ส่งมอบเครื่องหลังซ่อม · ต้นฉบับ — ร้านเก็บ');
    expect(doc.meta).toEqual([
      { label: 'เลขเคส', value: 'AS-20260907-0004' },
      { label: 'วันที่ส่งมอบ', value: '26 ก.ย. 2569 · 15:41 น.' },
      { label: 'อ้างอิงใบรับฝาก', value: '7 ก.ย. 2569' },
      { label: 'พนักงาน', value: 'นิภา' },
    ]);
    expect(valueOf(doc, 'ซ่อมที่')).toBe('iCare ลพบุรี · เลขเคลม IC-77821');
    expect(valueOf(doc, 'ส่งซ่อม — เสร็จ')).toBe('8 ก.ย. 2569 — 25 ก.ย. 2569');
    expect(valueOf(doc, 'ผู้จ่ายค่าซ่อม')).toBe('ร้าน');
    expect(valueOf(doc, 'ลูกค้าจ่าย')).toBe('ไม่มี');
    expect(valueOf(doc, 'ประกันร้าน')).toBe('ถึง 17 พ.ย. 2569 (ตามเดิม)');
    expect(block(doc, 'table')?.rows).toEqual([
      [
        'Apple iPhone 13 128GB · ดำ · มือสอง',
        '356812345674412',
        'F2LXK3P09Q',
        'เครื่องเดิมของลูกค้า ซ่อมแล้ว',
      ],
    ]);
    expect(block(doc, 'table')?.nowrapCols).toEqual([1, 2]);
    expect(doc.conditions).toBeUndefined();
    expect(doc.ack).toBe('ลูกค้าตรวจเครื่องและอุปกรณ์ตามรายการข้างต้นแล้ว เปิดใช้งานได้ปกติ');
    expect(doc.signatures[0].role).toBe('ลูกค้า (ผู้รับมอบ)');
    expect(doc.signatures[1]).toEqual({
      role: 'พนักงานผู้ส่งมอบ',
      name: 'นิภา',
      sub: 'ลพบุรี · 26 ก.ย. 2569',
    });
  });

  it('(h) ลูกค้าจ่าย / เคลมศูนย์ / ซ่อมที่ร้าน / ส่งมอบแล้ว = วันที่ส่งมอบจริง', () => {
    const customer = composeHandoverDoc(
      readyRepair({
        payer: 'CUSTOMER',
        actualCost: '1200',
        returnedToCustomerAt: new Date('2026-09-25T09:30:00.000Z'),
      }),
    );
    expect(valueOf(customer, 'ลูกค้าจ่าย')).toBe('1,200.00 บาท · ใบเสร็จรับเงินออกแยกจากใบนี้');
    expect(customer.meta[1]).toEqual({ label: 'วันที่ส่งมอบ', value: '25 ก.ย. 2569 · 16:30 น.' });
    const claim = composeHandoverDoc(readyRepair({ payer: 'SUPPLIER_CLAIM' }));
    expect(valueOf(claim, 'ผู้จ่ายค่าซ่อม')).toBe('เคลมศูนย์');
    expect(valueOf(claim, 'ลูกค้าจ่าย')).toBe('ไม่มี');
    const inShop = composeHandoverDoc(
      readyRepair({ supplierName: null, externalClaimNo: null, sentToRepairAt: null }),
    );
    expect(valueOf(inShop, 'ซ่อมที่')).toBe('ซ่อมที่ร้าน');
    expect(valueOf(inShop, 'ส่งซ่อม — เสร็จ')).toBe('— — 25 ก.ย. 2569');
  });

  const exchangeSource = (
    outcome: 'SAME_MODEL_EXCHANGE' | 'PRICED_EXCHANGE',
    ex: Partial<NonNullable<DocSource['exchange']>> = {},
    within7Days = outcome === 'SAME_MODEL_EXCHANGE',
  ) =>
    source({
      outcome,
      stage: 'CLOSED',
      closedAt: new Date('2026-09-16T06:20:00.000Z'),
      repair: null,
      warranty: { ...source().warranty, within7Days },
      exchange: {
        mode: outcome === 'PRICED_EXCHANGE' ? 'PRICED' : null,
        fromRepair: false,
        oldDeviceLabel: 'Samsung A55 128GB',
        oldImei: '354211098761188',
        newDeviceLabel: 'Samsung A55 128GB · ฟ้า',
        newImei: '354211098763301',
        // เปลี่ยนรุ่นเดิมก็ได้สัญญาใหม่เสมอ (DefectExchangeService ปิดสัญญาเดิมเป็น DEFECT_EXCHANGED)
        replacementContractNumber: outcome === 'PRICED_EXCHANGE' ? 'CT-2026-0951' : 'CT-2026-0960',
        newShopWarrantyEnd: new Date('2026-11-28T00:00:00.000Z'),
        newManufacturerWarrantyEnd: new Date('2027-09-03T00:00:00.000Z'),
        ...ex,
      },
    });

  it('(i) เปลี่ยนรุ่นเดิม: ตารางเครื่องเดิม/เครื่องที่ส่งมอบ + สัญญาใหม่แทนสัญญาเดิม + ค่าใช้จ่ายไม่มี + ประกันเครื่องใหม่', () => {
    const doc = composeHandoverDoc(exchangeSource('SAME_MODEL_EXCHANGE'));
    expect(doc.kicker).toBe('เปลี่ยนเครื่อง · ต้นฉบับ — ร้านเก็บ');
    expect(doc.meta[1]).toEqual({ label: 'วันที่ส่งมอบ', value: '16 ก.ย. 2569 · 13:20 น.' });
    const table = block(doc, 'table')!;
    expect(table.title).toBe('เปลี่ยนรุ่นเดิม ความจุเดิม ราคาเท่าเดิม (ภายใน 7 วันนับจากวันซื้อ)');
    expect(table.rows).toEqual([
      ['เครื่องเดิม — ลูกค้าส่งคืนร้าน', 'Samsung A55 128GB', '354211098761188'],
      ['เครื่องที่ส่งมอบ', 'Samsung A55 128GB · ฟ้า', '354211098763301'],
    ]);
    expect(table.strongRows).toEqual([1]);
    expect(table.nowrapCols).toEqual([2]);
    // C1 — สัญญาเดิมถูกปิด (DEFECT_EXCHANGED) เครื่องใหม่ผูกสัญญาใหม่ เลขใหม่ เงื่อนไขเดิม
    const pair = doc.blocks.find(
      (b): b is Extract<DocBlock, { type: 'pair' }> =>
        b.type === 'pair' && b.right.title === 'สัญญา',
    )!;
    expect(pair.right.rows).toEqual([
      { label: 'สัญญาผ่อน (ใหม่)', value: 'CT-2026-0960', strong: true },
      { label: 'แทนสัญญาเดิม', value: 'CT-2026-0912' },
      { label: 'เงื่อนไข', value: 'ค่างวดและวันครบกำหนดเท่าเดิม' },
    ]);
    expect(valueOf(doc, 'ผลต่อสัญญา')).toBeUndefined();
    expect(valueOf(doc, 'ลูกค้าจ่าย')).toBe('ไม่มี');
    expect(valueOf(doc, 'เหตุผล')).toBe('มีปัญหาภายใน 7 วันหลังซื้อ');
    expect(valueOf(doc, 'ประกันร้าน')).toBe('ถึง 28 พ.ย. 2569 (ตามสัญญา)');
    expect(valueOf(doc, 'ประกันศูนย์')).toBe('ถึง 3 ก.ย. 2570');
    expect(doc.ack).toBe(
      'ลูกค้าส่งคืนเครื่องเดิมให้ร้าน และตรวจเครื่องที่ส่งมอบพร้อมอุปกรณ์ตามรายการข้างต้นแล้ว เปิดใช้งานได้ปกติ',
    );
  });

  it('(i1) เปลี่ยนรุ่นเดิมที่ยังไม่มีเลขสัญญาใหม่ → "—" (ไม่ย้อนไปพิมพ์เลขสัญญาเดิม)', () => {
    const doc = composeHandoverDoc(
      exchangeSource('SAME_MODEL_EXCHANGE', { replacementContractNumber: null }),
    );
    expect(rowOf(doc, 'สัญญาผ่อน (ใหม่)')).toEqual({
      label: 'สัญญาผ่อน (ใหม่)',
      value: '—',
      strong: true,
    });
    expect(valueOf(doc, 'แทนสัญญาเดิม')).toBe('CT-2026-0912');
  });

  it('(i2) เปลี่ยนแบบมีราคา (PRICED หรือไม่รู้โหมด): สัญญาใหม่แทนสัญญาเดิม + ค่าใช้จ่ายตามสัญญาใหม่', () => {
    for (const mode of ['PRICED', null] as const) {
      const doc = composeHandoverDoc(exchangeSource('PRICED_EXCHANGE', { mode }));
      expect(block(doc, 'table')!.title).toBe('เปลี่ยนเครื่องแบบมีราคา (ทำสัญญาใหม่)');
      expect(valueOf(doc, 'สัญญาใหม่')).toBe('CT-2026-0951');
      expect(valueOf(doc, 'แทนสัญญาเดิม')).toBe('CT-2026-0912');
      expect(valueOf(doc, 'ค่างวด')).toBe('ตามสัญญาใหม่ที่ลูกค้าเซ็นแยก');
      expect(valueOf(doc, 'ลูกค้าจ่าย')).toBe(PRICED_EXCHANGE_COST_LINE);
      expect(valueOf(doc, 'เหตุผล')).toBeUndefined();
    }
  });

  it('(i3) เปลี่ยนรุ่นเดิม — เหตุผล/หัวตารางตามที่มาจริง: ใน 7 วัน · นอกกรอบ (ผจก. อนุมัติ) · มาจากใบซ่อม', () => {
    const suffix = ' (ภายใน 7 วันนับจากวันซื้อ)';
    const base = 'เปลี่ยนรุ่นเดิม ความจุเดิม ราคาเท่าเดิม';

    const within = composeHandoverDoc(exchangeSource('SAME_MODEL_EXCHANGE', {}, true));
    expect(block(within, 'table')!.title).toBe(`${base}${suffix}`);
    expect(valueOf(within, 'เหตุผล')).toBe('มีปัญหาภายใน 7 วันหลังซื้อ');

    const bypassed = composeHandoverDoc(exchangeSource('SAME_MODEL_EXCHANGE', {}, false));
    expect(block(bypassed, 'table')!.title).toBe(base);
    expect(valueOf(bypassed, 'เหตุผล')).toBe('อนุมัติเปลี่ยนนอกกรอบ 7 วัน');

    // ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม: ไม่อ้างกรอบ 7 วัน แม้ตอนแจ้งจะยังอยู่ในกรอบ
    for (const within7Days of [true, false]) {
      const repair = composeHandoverDoc(
        exchangeSource('SAME_MODEL_EXCHANGE', { fromRepair: true }, within7Days),
      );
      expect(block(repair, 'table')!.title).toBe(base);
      expect(valueOf(repair, 'เหตุผล')).toBe('ซ่อมไม่ได้ — เปลี่ยนรุ่นเดิมแทน');
    }
  });

  it('(i4) เปลี่ยนแบบมีราคาที่อนุมัติเป็น MEMO: สัญญาเดิม + บันทึกแนบท้าย · ลูกค้าไม่จ่าย · ไม่มีคำว่าสัญญาใหม่', () => {
    const doc = composeHandoverDoc(
      exchangeSource('PRICED_EXCHANGE', { mode: 'MEMO', replacementContractNumber: null }),
    );
    expect(block(doc, 'table')!.title).toBe('เปลี่ยนเครื่องราคาเท่าเดิม (บันทึกแนบท้ายสัญญาเดิม)');
    const pair = doc.blocks.find(
      (b): b is Extract<DocBlock, { type: 'pair' }> =>
        b.type === 'pair' && b.right.title === 'สัญญา',
    )!;
    expect(pair.right.rows).toEqual([
      { label: 'สัญญาผ่อน', value: 'CT-2026-0912', strong: true },
      { label: 'ผลต่อสัญญา', value: 'ใบเดิม เปลี่ยนเครื่องตามบันทึกแนบท้ายสัญญา' },
    ]);
    expect(valueOf(doc, 'ลูกค้าจ่าย')).toBe('ไม่มี');
    expect(valueOf(doc, 'เหตุผล')).toBeUndefined();
    const html = buildAfterSalesDocHtml(doc);
    expect(html).not.toContain('สัญญาใหม่');
    expect(html).not.toContain(PRICED_EXCHANGE_COST_LINE);
  });

  it('ทุกแบบ: HTML ไม่มีคำว่า "รับเครื่อง"', () => {
    const docs = [
      composeReceiptDoc(source()),
      composeReceiptDoc(source({ outcome: 'PRICED_EXCHANGE', repair: null })),
      composeHandoverDoc(readyRepair()),
      composeHandoverDoc(readyRepair({ payer: 'CUSTOMER' })),
      composeHandoverDoc(exchangeSource('SAME_MODEL_EXCHANGE')),
      composeHandoverDoc(exchangeSource('SAME_MODEL_EXCHANGE', {}, false)),
      composeHandoverDoc(exchangeSource('SAME_MODEL_EXCHANGE', { fromRepair: true })),
      composeHandoverDoc(exchangeSource('PRICED_EXCHANGE')),
      composeHandoverDoc(exchangeSource('PRICED_EXCHANGE', { mode: 'MEMO' })),
    ];
    for (const d of docs) expect(buildAfterSalesDocHtml(d)).not.toContain('รับเครื่อง');
  });
});

describe('handoverBlockReason', () => {
  it('(j) พิมพ์ได้เฉพาะ READY_FOR_PICKUP / CLOSED ที่มีทางออก · ซ่อมต้องมีใบซ่อม', () => {
    expect(
      handoverBlockReason({ outcome: 'REPAIR', stage: 'READY_FOR_PICKUP', hasRepairTicket: true }),
    ).toBeNull();
    expect(
      handoverBlockReason({
        outcome: 'SAME_MODEL_EXCHANGE',
        stage: 'CLOSED',
        hasRepairTicket: false,
      }),
    ).toBeNull();
    for (const stage of ['RECEIVED', 'IN_REPAIR', 'AWAITING_APPROVAL', 'CANCELLED'] as const)
      expect(handoverBlockReason({ outcome: 'REPAIR', stage, hasRepairTicket: true })).toBe(
        HANDOVER_NOT_READY_MSG,
      );
    expect(handoverBlockReason({ outcome: null, stage: 'CLOSED', hasRepairTicket: false })).toBe(
      HANDOVER_NOT_READY_MSG,
    );
    expect(
      handoverBlockReason({ outcome: 'REPAIR', stage: 'CLOSED', hasRepairTicket: false }),
    ).toBe('ไม่พบใบซ่อมของเคสนี้');
  });

  it('(k) เปลี่ยนรุ่นเดิมขายสด (ยังไม่เปิดใช้ — PR 5) → ยังไม่รองรับ ไม่ใช้ถ้อยคำสัญญาผ่อน', () => {
    for (const stage of ['READY_FOR_PICKUP', 'CLOSED', 'RECEIVED'] as const)
      expect(
        handoverBlockReason({
          outcome: 'CASH_SAME_MODEL_EXCHANGE',
          stage,
          hasRepairTicket: false,
        }),
      ).toBe(HANDOVER_CASH_UNSUPPORTED_MSG);
    expect(HANDOVER_CASH_UNSUPPORTED_MSG).toBe('ใบส่งมอบของการเปลี่ยนเครื่องขายสดยังไม่รองรับ');
  });
});
