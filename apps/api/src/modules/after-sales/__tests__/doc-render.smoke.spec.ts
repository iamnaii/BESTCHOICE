import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildAfterSalesDocHtml } from '../documents/after-sales-doc-html';
import {
  composeHandoverDoc,
  composeReceiptDoc,
  composeReplacementHandoverDoc,
  composeReturnDoc,
  type DocSource,
} from '../documents/after-sales-doc-compose';
import { AfterSalesPdfRenderer } from '../documents/after-sales-pdf.renderer';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** กรณีเนื้อหายาวสุดที่ระบบยอมให้เกิด: อาการ/อื่น ๆ ถูกตัดแล้ว, รูปครบ 6, ชื่อยาว — คอมพาวด์เวิร์สต์เคส
 * (หลาย ๆ ฟิลด์ชนขอบเขตพร้อมกัน) ไม่ใช่เคสจริงที่พบได้บ่อย — ดูฟิกซ์เจอร์ `realistic` ด้านล่างสำหรับ
 * เคสทั่วไปที่ต้องพอดี 1 หน้าเสมอ */
const extreme: DocSource = {
  company: {
    nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด',
    address:
      'เลขที่ 456/21 ชั้น 2 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมืองลพบุรี จังหวัดลพบุรี 15000',
    taxId: '0165568000050',
    phone: '063-134-6356',
  },
  caseNumber: 'AS-20260907-0004',
  branchName: 'สาขาลพบุรี (ถนนนารายณ์มหาราช)',
  receivedAt: new Date('2026-09-07T03:12:00.000Z'),
  receivedByName: 'สุดารัตน์ ทดสอบระบบ',
  printedAt: new Date('2026-09-07T03:14:00.000Z'),
  printedByName: 'สุดารัตน์ ทดสอบระบบ',
  customerName: 'นางสาวสมหญิงประเสริฐศักดิ์ ใจดีมีทรัพย์สมบูรณ์',
  customerPhone: '0812344412',
  lineLinked: true,
  source: 'INSTALLMENT_CONTRACT',
  contractNumber: 'CT-2026-0912',
  saleNumber: null,
  deviceLabel: 'Apple iPhone 16 Pro Max 1TB · Desert Titanium · มือสอง',
  deviceImei: '356812345674412',
  deviceSerial: 'F2LXK3P09Q',
  accessories: { box: true, charger: true, case: true, other: 'ข'.repeat(200) },
  unlockConfirmed: true,
  symptom: 'เปิดไม่ติด ชาร์จไม่เข้า '.repeat(40),
  photoCount: 6,
  photos: [PNG, PNG, PNG, PNG, PNG, PNG],
  warranty: {
    purchasedAt: new Date('2026-08-19T05:00:00.000Z'),
    shopWarrantyEnd: new Date('2026-11-17T00:00:00.000Z'),
    manufacturerWarrantyEnd: new Date('2027-09-17T00:00:00.000Z'),
    within7Days: false,
  },
  outcome: 'REPAIR',
  stage: 'READY_FOR_PICKUP',
  closedAt: null,
  repair: {
    payer: 'CUSTOMER',
    estimatedCost: '12500.00',
    actualCost: '12500.00',
    supplierName: 'ศูนย์บริการ iCare ลพบุรี (ผู้ให้บริการที่ได้รับอนุญาต)',
    externalClaimNo: 'IC-77821-2026-09',
    sentToRepairAt: new Date('2026-09-08T07:00:00.000Z'),
    repairedAt: new Date('2026-09-25T04:00:00.000Z'),
    returnedToCustomerAt: null,
  },
  exchange: {
    mode: 'PRICED',
    fromRepair: false,
    oldDeviceLabel: 'Apple iPhone 16 Pro Max 1TB',
    oldImei: '356812345674412',
    newDeviceLabel: 'Apple iPhone 16 Pro Max 1TB · Desert Titanium',
    newImei: '356812345679999',
    replacementContractNumber: 'CT-2026-0951',
    newShopWarrantyEnd: new Date('2026-12-16T00:00:00.000Z'),
    newManufacturerWarrantyEnd: new Date('2027-09-16T00:00:00.000Z'),
    saleType: null,
    financeCompany: null,
    sevenDayEnd: null,
    deliveredNote: null,
    approvedByName: null,
    approvedAt: null,
    repairTicketNumber: null,
  },
};

/** เคสทั่วไปที่พบได้บ่อยจริง (ไม่ใช่ทุกฟิลด์ชนขอบเขตพร้อมกันเหมือน `extreme`) — ต้องพอดี 1 หน้าเสมอ
 * ทั้ง 3 เอกสาร (fix round 1 — ควบคุมโดยการตัดสินของ controller) */
const realistic: DocSource = {
  ...extreme,
  symptom:
    'เปิดไม่ติด ชาร์จไม่เข้า เริ่มเป็นเมื่อวาน ลองชาร์จสายอื่นแล้วก็ไม่เข้า ไม่เคยตกน้ำ ไม่เคยซ่อมที่ไหนมาก่อน',
  accessories: { ...extreme.accessories, other: 'ฟิล์มกระจก' },
  customerName: 'สมชาย ใจดี',
  branchName: 'ลพบุรี',
  receivedByName: 'สุดา',
  printedByName: 'สุดา',
  repair: { ...extreme.repair!, supplierName: 'ศูนย์ iCare ลพบุรี' },
};

const run = process.env.AFTER_SALES_PDF_SMOKE === '1' ? it : it.skip;

describe('after-sales PDF — A4 หน้าเดียวบน Chromium จริง (AFTER_SALES_PDF_SMOKE=1)', () => {
  jest.setTimeout(120_000);
  afterAll(() => AfterSalesPdfRenderer.closeShared());

  const priced = (s: DocSource): DocSource => ({
    ...s,
    outcome: 'PRICED_EXCHANGE',
    repair: null,
    stage: 'CLOSED',
  });

  const cases: [string, () => ReturnType<typeof composeReceiptDoc>, number][] = [
    // (a) เคสจริงทั่วไป — ต้องพอดี 1 หน้าเป๊ะทั้ง 3 แบบ
    ['realistic-receipt', () => composeReceiptDoc(realistic), 1],
    ['realistic-handover-repair', () => composeHandoverDoc(realistic), 1],
    ['realistic-handover-priced', () => composeHandoverDoc(priced(realistic)), 1],
    // (b) คอมพาวด์เวิร์สต์เคส — ใบรับฝากยอม ≤ 2 หน้า (เงื่อนไข+ack+ลายเซ็น+footer ต้องอยู่กลุ่มเดียว
    // ถ้าล้นไปหน้า 2 — ตรวจด้วยตาที่ `doc-render.smoke.spec.ts` ในรายงาน) ส่วนใบส่งมอบยังต้อง 1 หน้า
    // (ไม่มีเงื่อนไขปิดท้าย เนื้อหาน้อยกว่าใบรับฝากเสมอ)
    ['extreme-receipt', () => composeReceiptDoc(extreme), 2],
    ['extreme-handover-repair', () => composeHandoverDoc(extreme), 1],
    ['extreme-handover-priced', () => composeHandoverDoc(priced(extreme)), 1],
  ];

  for (const [name, make, maxPages] of cases) {
    run(`${name} ≤ ${maxPages} หน้า`, async () => {
      const pdf = await new AfterSalesPdfRenderer().htmlToPdf(buildAfterSalesDocHtml(make()));
      if (process.env.AFTER_SALES_PDF_OUT)
        writeFileSync(join(process.env.AFTER_SALES_PDF_OUT, `${name}.pdf`), pdf);
      const pages = pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? [];
      expect(pages.length).toBeGreaterThanOrEqual(1);
      expect(pages.length).toBeLessThanOrEqual(maxPages);
      expect(pdf.length).toBeLessThan(1_500_000);
    });
  }

  // PR 5 — เคสขายสด: ใบรับคืน + ใบส่งมอบเครื่องทดแทน ใน PDF เดียว ต้องได้ 2 หน้าพอดี
  const cashExchange: DocSource = {
    ...realistic,
    source: 'CASH_SALE',
    contractNumber: null,
    saleNumber: 'SL-20261009-0012',
    outcome: 'CASH_SAME_MODEL_EXCHANGE',
    stage: 'CLOSED',
    closedAt: new Date('2026-10-14T04:00:00.000Z'),
    repair: null,
    warranty: {
      purchasedAt: new Date('2026-10-09T05:00:00.000Z'),
      shopWarrantyEnd: new Date('2026-12-08T00:00:00.000Z'),
      manufacturerWarrantyEnd: null,
      within7Days: true,
    },
    exchange: {
      ...extreme.exchange!,
      mode: null,
      replacementContractNumber: null,
      newManufacturerWarrantyEnd: null,
      saleType: 'CASH',
      sevenDayEnd: new Date('2026-10-20T00:00:00.000Z'),
      deliveredNote: 'ส่งมอบเครื่องทดแทน · ใบขาย SL-20261009-0012 · อุปกรณ์: กล่อง, สายชาร์จ',
      approvedByName: 'สุดา',
      approvedAt: new Date('2026-10-12T06:00:00.000Z'),
    },
  };
  run('cash-exchange-docs = 2 หน้าพอดี (ใบรับคืน + ใบส่งมอบเครื่องทดแทน)', async () => {
    const pdf = await new AfterSalesPdfRenderer().htmlToPdf(
      buildAfterSalesDocHtml([
        composeReturnDoc(cashExchange),
        composeReplacementHandoverDoc(cashExchange),
      ]),
    );
    if (process.env.AFTER_SALES_PDF_OUT)
      writeFileSync(join(process.env.AFTER_SALES_PDF_OUT, 'cash-exchange-docs.pdf'), pdf);
    const pages = pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? [];
    expect(pages.length).toBe(2);
    expect(pdf.length).toBeLessThan(1_500_000);
  });
});
