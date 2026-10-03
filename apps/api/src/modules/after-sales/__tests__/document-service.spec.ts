import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Readable } from 'stream';
import { AfterSalesDocumentService } from '../services/after-sales-document.service';
import { HANDOVER_NOT_READY_MSG } from '../documents/after-sales-doc-compose';
import { PRICED_EXCHANGE_COST_LINE } from '../utils/after-sales-line-copy.util';
import { SWITCHED_TO_REPAIR_NOTE } from '../utils/after-sales-outcomes.util';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const user = { id: 'u-1', role: 'SALES', branchId: 'br-1' };

function caseDetail(over: Record<string, unknown> = {}) {
  return {
    id: CASE_ID,
    caseNumber: 'AS-20260907-0004',
    branchId: 'br-1',
    source: 'INSTALLMENT_CONTRACT',
    contractId: 'ct-1',
    saleId: null,
    productId: 'p-1',
    outcome: 'REPAIR',
    stage: 'RECEIVED',
    receivedAt: new Date('2026-09-07T03:12:00.000Z'),
    closedAt: null,
    deviceBrand: 'Apple',
    deviceModel: 'iPhone 13 128GB',
    deviceImei: '356812345674412',
    deviceSerial: 'F2LXK3P09Q',
    symptom: 'เปิดไม่ติด ชาร์จไม่เข้า',
    accessories: { box: true, charger: true, case: false },
    unlockConfirmed: true,
    warrantySnapshot: {
      status: 'IN_SHOP_WARRANTY',
      daysRemainingIn7Day: 0,
      purchasedAt: '2026-08-19T05:00:00.000Z',
      shopWarrantyEndDate: '2026-11-17T00:00:00.000Z',
      manufacturerWarrantyEndDate: null,
      checkedAt: '2026-09-07T03:12:00.000Z',
    },
    customer: { id: 'cu-1', name: 'สมชาย ใจดี', phone: '0812344412' },
    branch: { id: 'br-1', name: 'ลพบุรี' },
    receivedBy: { id: 'u-2', name: 'สุดา' },
    repairTicket: {
      payer: 'SHOP',
      estimatedCost: null,
      actualCost: null,
      repairSupplier: null,
      externalClaimNo: null,
      sentToRepairAt: null,
      repairedAt: null,
      returnedToCustomerAt: null,
      deletedAt: null,
    },
    exchange: null,
    lineLinked: true,
    timeline: [],
    ...over,
  };
}

function setup(detail = caseDetail(), photoKeys: string[] = []) {
  const prisma = {
    afterSalesCase: { findUniqueOrThrow: jest.fn().mockResolvedValue({ photoKeys }) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'นิภา' }) },
    branch: {
      findUnique: jest.fn().mockResolvedValue({
        company: {
          nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด',
          address: 'ลพบุรี',
          taxId: '0165568000050',
          phone: null,
        },
      }),
    },
    companyInfo: { findFirst: jest.fn().mockResolvedValue(null) },
    contract: {
      findUnique: jest.fn().mockResolvedValue({
        contractNumber: 'CT-2026-0912',
        shopWarrantyEndDate: new Date('2026-11-17T00:00:00.000Z'),
      }),
    },
    sale: { findUnique: jest.fn().mockResolvedValue(null) },
    product: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ color: 'ดำ', category: 'PHONE_USED', warrantyExpireDate: null }),
    },
    afterSalesEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const storage = { getStream: jest.fn() };
  const query = { getCase: jest.fn().mockResolvedValue(detail) };
  const renderer = { htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')) };
  const svc = new AfterSalesDocumentService(
    prisma as any,
    storage as any,
    query as any,
    renderer as any,
  );
  const html = () => renderer.htmlToPdf.mock.calls[0][0] as string;
  return { prisma, storage, query, renderer, svc, html };
}

describe('AfterSalesDocumentService.render', () => {
  it('(a) ใบรับฝาก: ขอบเขตผ่าน getCase → HTML มีข้อมูลเคส → PDF + event PRINTED', async () => {
    const t = setup();
    const out = await t.svc.render(CASE_ID, 'RECEIPT', user);
    expect(t.query.getCase).toHaveBeenCalledWith(CASE_ID, user);
    expect(out).toEqual({ pdf: Buffer.from('%PDF-1.4'), caseNumber: 'AS-20260907-0004' });
    for (const text of [
      'ใบรับฝากเครื่อง',
      'AS-20260907-0004',
      'สัญญาผ่อน CT-2026-0912',
      'Apple iPhone 13 128GB · ดำ · มือสอง',
      'สมชาย ใจดี',
      'โดย นิภา',
    ])
      expect(t.html()).toContain(text);
    expect(t.prisma.afterSalesEvent.create).toHaveBeenCalledWith({
      data: { caseId: CASE_ID, kind: 'PRINTED', note: 'ใบรับฝากเครื่อง', actorId: 'u-1' },
    });
  });

  it('(b) สาขาอื่น: getCase ปฏิเสธ → ไม่แตะ storage/renderer/event', async () => {
    const t = setup(caseDetail(), ['after-sales/x/intake-1.jpg']);
    t.query.getCase.mockRejectedValue(new ForbiddenException('ไม่สามารถเข้าถึงสาขาอื่นได้'));
    await expect(t.svc.render(CASE_ID, 'RECEIPT', user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.storage.getStream).not.toHaveBeenCalled();
    expect(t.renderer.htmlToPdf).not.toHaveBeenCalled();
    expect(t.prisma.afterSalesEvent.create).not.toHaveBeenCalled();
  });

  it('(c) ใบส่งมอบของเคสที่ยังไม่พร้อม → 400 ไทย ไม่เปิด Chromium', async () => {
    const t = setup(caseDetail({ stage: 'IN_REPAIR' }));
    await expect(t.svc.render(CASE_ID, 'HANDOVER', user)).rejects.toThrow(
      new BadRequestException(HANDOVER_NOT_READY_MSG),
    );
    expect(t.renderer.htmlToPdf).not.toHaveBeenCalled();
  });

  it('(d) รูป: อ่านได้ = ฝัง data URL · storage ล้ม/นามสกุลแปลก = "เปิดรูปไม่ได้" (ไม่ 500)', async () => {
    const t = setup(caseDetail(), [
      'after-sales/x/intake-1.jpg',
      'after-sales/x/intake-2.png',
      'after-sales/x/intake-3.gif',
    ]);
    t.storage.getStream
      .mockResolvedValueOnce(Readable.from([Buffer.from('abc')]))
      .mockRejectedValueOnce(new Error('NoSuchKey'));
    await t.svc.render(CASE_ID, 'RECEIPT', user);
    expect(t.storage.getStream).toHaveBeenCalledTimes(2);
    expect(t.html()).toContain('src="data:image/jpeg;base64,YWJj"');
    expect(t.html().match(/<span>เปิดรูปไม่ได้<\/span>/g)).toHaveLength(2);
    expect(t.html().match(/<span>ไม่ได้ถ่าย<\/span>/g)).toHaveLength(3);
  });

  it('(e) กันซ้ำ: เคยพิมพ์เอกสารเดิมโดยคนเดิมใน 5 นาที → ไม่เขียน event ใหม่', async () => {
    const t = setup();
    t.prisma.afterSalesEvent.findFirst.mockResolvedValue({ id: 'e-1' });
    const before = Date.now();
    await t.svc.render(CASE_ID, 'RECEIPT', user);
    const where = t.prisma.afterSalesEvent.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      caseId: CASE_ID,
      kind: 'PRINTED',
      note: 'ใบรับฝากเครื่อง',
      actorId: 'u-1',
    });
    expect(before - where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(5 * 60 * 1000 - 1000);
    expect(before - where.createdAt.gte.getTime()).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(t.prisma.afterSalesEvent.create).not.toHaveBeenCalled();
  });

  it('(f) ใบส่งมอบหลังซ่อม ลูกค้าจ่าย: ยอดจริง + ไม่อ่านรูป + event "ใบส่งมอบ"', async () => {
    const t = setup(
      caseDetail({
        stage: 'READY_FOR_PICKUP',
        repairTicket: {
          ...caseDetail().repairTicket,
          payer: 'CUSTOMER',
          actualCost: { toString: () => '1200.00' },
          repairedAt: new Date('2026-09-25T04:00:00.000Z'),
        },
      }),
      ['after-sales/x/intake-1.jpg'],
    );
    await t.svc.render(CASE_ID, 'HANDOVER', user);
    expect(t.storage.getStream).not.toHaveBeenCalled();
    expect(t.html()).toContain('1,200.00 บาท');
    expect(t.html()).toContain('ซ่อมที่ร้าน');
    expect(t.prisma.afterSalesEvent.create).toHaveBeenCalledWith({
      data: { caseId: CASE_ID, kind: 'PRINTED', note: 'ใบส่งมอบ', actorId: 'u-1' },
    });
  });

  it('(g) สาขาไม่ผูกบริษัท → ใช้บริษัท SHOP', async () => {
    const t = setup();
    t.prisma.branch.findUnique.mockResolvedValue({ company: null });
    t.prisma.companyInfo.findFirst.mockResolvedValue({
      nameTh: 'SHOP COMPANY',
      address: '',
      taxId: '',
      phone: null,
    });
    await t.svc.render(CASE_ID, 'RECEIPT', user);
    expect(t.prisma.companyInfo.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyCode: 'SHOP', deletedAt: null } }),
    );
    expect(t.html()).toContain('SHOP COMPANY');
  });

  it('(h) เขียน event ล้ม → การพิมพ์ยังสำเร็จ', async () => {
    const t = setup();
    t.prisma.afterSalesEvent.create.mockRejectedValue(new Error('db down'));
    await expect(t.svc.render(CASE_ID, 'RECEIPT', user)).resolves.toMatchObject({
      caseNumber: 'AS-20260907-0004',
    });
  });

  it('(h2) m11 — สร้าง PDF ไม่ทันเวลา (503) → ส่ง error ต่อ + ไม่ลงไทม์ไลน์ PRINTED', async () => {
    const t = setup();
    t.renderer.htmlToPdf.mockRejectedValue(
      new ServiceUnavailableException('สร้างเอกสารไม่ทันเวลา กรุณาลองใหม่'),
    );
    await expect(t.svc.render(CASE_ID, 'RECEIPT', user)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(t.prisma.afterSalesEvent.findFirst).not.toHaveBeenCalled();
    expect(t.prisma.afterSalesEvent.create).not.toHaveBeenCalled();
  });

  it('(i) ใบส่งมอบเปลี่ยนเครื่องมีราคา: เลขสัญญาใหม่ + ประกันสัญญาใหม่ + เครื่องใหม่', async () => {
    const t = setup(
      caseDetail({
        outcome: 'PRICED_EXCHANGE',
        stage: 'CLOSED',
        closedAt: new Date('2026-09-16T06:20:00.000Z'),
        repairTicket: null,
        exchange: {
          kind: 'PRICED',
          oldProduct: {
            brand: 'Samsung',
            model: 'A55',
            storage: '128GB',
            imeiSerial: '354211098761188',
          },
          newProduct: {
            id: 'p-new',
            brand: 'Samsung',
            model: 'A56',
            storage: '256GB',
            imeiSerial: '354211098769999',
          },
          replacementContract: { id: 'ct-new', contractNumber: 'CT-2026-0951', status: 'ACTIVE' },
        },
      }),
    );
    t.prisma.contract.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'ct-new'
        ? {
            contractNumber: 'CT-2026-0951',
            shopWarrantyEndDate: new Date('2026-12-16T00:00:00.000Z'),
          }
        : {
            contractNumber: 'CT-2026-0912',
            shopWarrantyEndDate: new Date('2026-11-17T00:00:00.000Z'),
          },
    );
    t.prisma.product.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'p-new'
        ? {
            color: 'ดำ',
            category: 'PHONE_NEW',
            warrantyExpireDate: new Date('2027-09-16T00:00:00.000Z'),
          }
        : { color: 'ฟ้า', category: 'PHONE_NEW', warrantyExpireDate: null },
    );
    await t.svc.render(CASE_ID, 'HANDOVER', user);
    for (const text of [
      'CT-2026-0951',
      'แทนสัญญาเดิม',
      'Samsung A56 256GB · ดำ',
      '354211098769999',
      'ถึง 16 ธ.ค. 2569 (ตามสัญญา)',
      'ถึง 16 ก.ย. 2570',
    ])
      expect(t.html()).toContain(text);
  });

  const oldProduct = {
    brand: 'Samsung',
    model: 'A55',
    storage: '128GB',
    imeiSerial: '354211098761188',
  };
  const newProduct = {
    id: 'p-new',
    brand: 'Samsung',
    model: 'A55',
    storage: '128GB',
    imeiSerial: '354211098763301',
  };
  const sameModelCase = (over: Record<string, unknown> = {}) =>
    caseDetail({
      outcome: 'SAME_MODEL_EXCHANGE',
      stage: 'CLOSED',
      closedAt: new Date('2026-09-16T06:20:00.000Z'),
      repairTicket: null,
      exchange: {
        kind: 'SAME_MODEL',
        mode: null,
        oldProduct,
        newProduct,
        replacementContract: { id: 'ct-new', contractNumber: 'CT-2026-0960', status: 'ACTIVE' },
      },
      ...over,
    });
  const contractByIdMock = async ({ where }: { where: { id: string } }) =>
    where.id === 'ct-new'
      ? {
          contractNumber: 'CT-2026-0960',
          shopWarrantyEndDate: new Date('2026-12-16T00:00:00.000Z'),
        }
      : {
          contractNumber: 'CT-2026-0912',
          shopWarrantyEndDate: new Date('2026-11-17T00:00:00.000Z'),
        };

  it('(j) ใบส่งมอบเปลี่ยนรุ่นเดิม (C1): สัญญาเดิมถูกปิด → พิมพ์เลขสัญญาใหม่ + "แทนสัญญาเดิม"', async () => {
    const t = setup(sameModelCase());
    t.prisma.contract.findUnique.mockImplementation(contractByIdMock);
    await t.svc.render(CASE_ID, 'HANDOVER', user);
    expect(t.html()).toContain(
      '<span>สัญญาผ่อน (ใหม่)</span><span><strong>CT-2026-0960</strong></span>',
    );
    expect(t.html()).toContain('<span>แทนสัญญาเดิม</span><span>CT-2026-0912</span>');
    expect(t.html()).toContain('<span>เงื่อนไข</span><span>ค่างวดและวันครบกำหนดเท่าเดิม</span>');
    expect(t.html()).not.toContain('<span>สัญญาผ่อน</span><span><strong>CT-2026-0912</strong>');
    expect(t.html()).not.toContain('ผลต่อสัญญา');
    expect(t.html()).toContain('ถึง 16 ธ.ค. 2569 (ตามสัญญา)');
  });

  it('(k) ที่มาของเปลี่ยนรุ่นเดิม (I3): ใบซ่อม REPLACED = ซ่อมไม่ได้ · ใบซ่อมถูกลบไม่นับ · ไม่มีใบซ่อม = ตามกรอบ 7 วัน', async () => {
    const within7 = { ...caseDetail().warrantySnapshot, daysRemainingIn7Day: 3 };
    const replacedTicket = { ...caseDetail().repairTicket, status: 'REPLACED' };

    const fromRepair = setup(
      sameModelCase({ repairTicket: replacedTicket, warrantySnapshot: within7 }),
    );
    fromRepair.prisma.contract.findUnique.mockImplementation(contractByIdMock);
    await fromRepair.svc.render(CASE_ID, 'HANDOVER', user);
    expect(fromRepair.html()).toContain(
      '<span>เหตุผล</span><span>ซ่อมไม่ได้ — เปลี่ยนรุ่นเดิมแทน</span>',
    );
    expect(fromRepair.html()).not.toContain('ภายใน 7 วันนับจากวันซื้อ');

    const deletedTicket = setup(
      sameModelCase({
        repairTicket: { ...replacedTicket, deletedAt: new Date('2026-09-10T00:00:00.000Z') },
        warrantySnapshot: within7,
      }),
    );
    deletedTicket.prisma.contract.findUnique.mockImplementation(contractByIdMock);
    await deletedTicket.svc.render(CASE_ID, 'HANDOVER', user);
    expect(deletedTicket.html()).toContain(
      '<span>เหตุผล</span><span>มีปัญหาภายใน 7 วันหลังซื้อ</span>',
    );
    expect(deletedTicket.html()).toContain('(ภายใน 7 วันนับจากวันซื้อ)');

    const bypassed = setup(sameModelCase());
    bypassed.prisma.contract.findUnique.mockImplementation(contractByIdMock);
    await bypassed.svc.render(CASE_ID, 'HANDOVER', user);
    expect(bypassed.html()).toContain(
      '<span>เหตุผล</span><span>อนุมัติเปลี่ยนนอกกรอบ 7 วัน</span>',
    );
  });

  it('(l) ใบส่งมอบเปลี่ยนแบบมีราคาที่อนุมัติเป็น MEMO (I2): สัญญาเดิม + บันทึกแนบท้าย · ลูกค้าจ่ายไม่มี', async () => {
    const t = setup(
      caseDetail({
        outcome: 'PRICED_EXCHANGE',
        stage: 'CLOSED',
        closedAt: new Date('2026-09-16T06:20:00.000Z'),
        repairTicket: null,
        exchange: {
          kind: 'PRICED',
          mode: 'MEMO',
          oldProduct,
          newProduct,
          replacementContract: null,
        },
      }),
    );
    await t.svc.render(CASE_ID, 'HANDOVER', user);
    for (const text of [
      'เปลี่ยนเครื่องราคาเท่าเดิม (บันทึกแนบท้ายสัญญาเดิม)',
      '<span>สัญญาผ่อน</span><span><strong>CT-2026-0912</strong></span>',
      '<span>ผลต่อสัญญา</span><span>ใบเดิม เปลี่ยนเครื่องตามบันทึกแนบท้ายสัญญา</span>',
      '<span>ลูกค้าจ่าย</span><span><strong>ไม่มี</strong></span>',
    ])
      expect(t.html()).toContain(text);
    expect(t.html()).not.toContain('สัญญาใหม่');
    expect(t.html()).not.toContain(PRICED_EXCHANGE_COST_LINE);
  });
  it('(m) ใบรับฝากพิมพ์ซ้ำ = ทางออกตอนรับฝาก: เปลี่ยนใจเป็นซ่อมทีหลัง → ยังพิมพ์ "เปลี่ยนรุ่นเดิม" ไม่มีผู้จ่ายค่าซ่อม', async () => {
    const t = setup(
      caseDetail({
        outcome: 'REPAIR',
        repairTicket: { ...caseDetail().repairTicket, payer: 'CUSTOMER', status: 'OPEN' },
        timeline: [
          { at: new Date(), kind: 'RECEIVED', note: null },
          { at: new Date(), kind: 'OUTCOME_SET', note: 'เปลี่ยนรุ่นเดิม · รอ ผจก.สาขา ยืนยัน' },
          {
            at: new Date(),
            kind: 'OUTCOME_SET',
            note: `${SWITCHED_TO_REPAIR_NOTE} · ผู้จ่าย CUSTOMER`,
          },
        ],
      }),
    );
    await t.svc.render(CASE_ID, 'RECEIPT', user);
    expect(t.html()).toContain('<span>ทางออก</span><span><strong>เปลี่ยนรุ่นเดิม</strong></span>');
    expect(t.html()).not.toContain('ผู้จ่ายค่าซ่อม');
  });

  it('(n) ใบรับฝากพิมพ์ซ้ำ = ทางออกตอนรับฝาก: ซ่อมไม่ได้แล้วเปลี่ยนรุ่นเดิม (ใบซ่อม REPLACED) → ยังพิมพ์ "ซ่อม" + ผู้จ่าย', async () => {
    const t = setup(
      sameModelCase({ repairTicket: { ...caseDetail().repairTicket, status: 'REPLACED' } }),
    );
    t.prisma.contract.findUnique.mockImplementation(contractByIdMock);
    await t.svc.render(CASE_ID, 'RECEIPT', user);
    expect(t.html()).toContain('<span>ทางออก</span><span><strong>ซ่อม</strong></span>');
    expect(t.html()).toContain('<span>ผู้จ่ายค่าซ่อม</span><span>ร้าน</span>');
  });
});
