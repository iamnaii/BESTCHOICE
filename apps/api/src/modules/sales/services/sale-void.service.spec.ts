import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { SaleVoidService } from './sale-void.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ExchangeCancelReversalTemplate } from '../../journal/cpa-templates/exchange-cancel-reversal.template';

/**
 * เทสด่านทุกข้อของการยกเลิกใบขาย (G1-G7 + ข้อมูลเพี้ยน) — pattern mock เดียวกับ
 * `sale-writer.service.spec.ts` (tx mock ต่อเทส + `$transaction` เรียก callback ตรง ๆ)
 *
 * ทุกเทสที่ด่านตกต้องพิสูจน์ว่า **ไม่มีอะไรถูกเขียน** ไม่ใช่แค่ว่ามันโยน —
 * เจตนาของงานคือ "อ่านครบก่อนแตะ state" ไม่ใช่ "rollback เอาทีหลัง"
 */
describe('SaleVoidService.voidSale', () => {
  let service: SaleVoidService;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let tx: any;
  let prisma: any;
  let reversalTemplate: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const CASH_SALE = {
    id: 's1',
    saleNumber: 'SA-0001',
    saleType: 'CASH',
    productId: 'p1',
    bundleProductIds: ['p2'],
    contractId: null,
    onlineOrderId: null,
    deletedAt: null,
    netAmount: new Decimal(12000),
  };

  const EXT_SALE = {
    id: 's2',
    saleNumber: 'SA-0002',
    saleType: 'EXTERNAL_FINANCE',
    productId: 'p9',
    bundleProductIds: [],
    contractId: null,
    onlineOrderId: null,
    deletedAt: null,
    netAmount: new Decimal(20000),
  };

  /** ยืนยันว่าไม่มี write ใดเกิดขึ้นเลย (ใช้ในทุกเทสที่ด่านตก) */
  const expectNothingWritten = () => {
    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.sale.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.salesCommission.updateMany).not.toHaveBeenCalled();
    expect(tx.financeReceivable.updateMany).not.toHaveBeenCalled();
    expect(reversalTemplate.reverse).not.toHaveBeenCalled();
  };

  beforeEach(async () => {
    tx = {
      sale: {
        findUnique: jest.fn().mockResolvedValue({ ...CASH_SALE }),
        update: jest.fn().mockResolvedValue({}),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p1', status: 'SOLD_CASH', deletedAt: null },
          { id: 'p2', status: 'SOLD_CASH', deletedAt: null },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      repairTicket: { findFirst: jest.fn().mockResolvedValue(null) },
      // ── ชั้นที่ `assertProductNotHeld` อ่าน ──
      contract: { findFirst: jest.fn().mockResolvedValue(null) },
      productReservation: { findFirst: jest.fn().mockResolvedValue(null) },
      onlineOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      // ── ด่านเงิน ──
      financeReceivable: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      salesCommission: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', status: 'PENDING', period: '2026-08', salespersonId: 'sp1' },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // รอบจ่ายค่าคอม (`CommissionPayout`) — default = ยังไม่มีรอบจ่ายของงวดนี้
      commissionPayout: { findFirst: jest.fn().mockResolvedValue(null) },
      journalEntry: {
        findMany: jest
          .fn()
          // (1) JE ต้นทางของใบขาย
          .mockResolvedValueOnce([{ id: 'je-1', companyId: 'shop-co' }])
          // (2) entryNumber ของ mirror ที่เพิ่งสร้าง
          .mockResolvedValueOnce([{ entryNumber: 'JE-202608-0099' }]),
      },
      // ── period guard (`validatePeriodOpen`) ──
      accountingPeriod: { findUnique: jest.fn().mockResolvedValue(null) },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };

    prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => cb(tx)),
    };

    reversalTemplate = {
      reverse: jest.fn().mockResolvedValue({ reversalJeIds: ['rev-1'], redirectedTotals: {} }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaleVoidService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExchangeCancelReversalTemplate, useValue: reversalTemplate },
      ],
    }).compile();

    service = module.get<SaleVoidService>(SaleVoidService);
  });

  // ── ไม่พบใบขาย ────────────────────────────────────────────────────────────
  it('ไม่พบใบขาย → NotFound และไม่เขียนอะไร', async () => {
    tx.sale.findUnique.mockResolvedValue(null);
    await expect(service.voidSale('nope', 'u1', 'คีย์ผิดรุ่น')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expectNothingWritten();
  });

  // ── G1 ────────────────────────────────────────────────────────────────────
  it('G1: ใบขายถูกยกเลิกไปแล้ว → ปฏิเสธ และไม่เขียนอะไร', async () => {
    tx.sale.findUnique.mockResolvedValue({ ...CASH_SALE, deletedAt: new Date('2026-08-01') });
    await expect(service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น')).rejects.toThrow(/ยกเลิกไปแล้ว/);
    expectNothingWritten();
  });

  // ── INSTALLMENT อยู่นอกขอบเขต ─────────────────────────────────────────────
  it('ใบขายผ่อนของเรา (INSTALLMENT) → ชี้ไปเส้นทางยกเลิกสัญญา ไม่ทำที่นี่', async () => {
    tx.sale.findUnique.mockResolvedValue({ ...CASH_SALE, saleType: 'INSTALLMENT' });
    await expect(service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น')).rejects.toThrow(/ยกเลิกสัญญา/);
    expectNothingWritten();
  });

  // ── ข้อมูลเพี้ยน ──────────────────────────────────────────────────────────
  it('ข้อมูลเพี้ยน: ใบขายสดมี contractId → ปฏิเสธ', async () => {
    tx.sale.findUnique.mockResolvedValue({ ...CASH_SALE, contractId: 'ct-1' });
    await expect(service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น')).rejects.toThrow(/ผิดปกติ/);
    expectNothingWritten();
  });

  it('ข้อมูลเพี้ยน: หาสินค้าของใบขายไม่ครบ → ปฏิเสธก่อนแตะ state', async () => {
    tx.product.findMany.mockResolvedValue([{ id: 'p1', status: 'SOLD_CASH', deletedAt: null }]);
    await expect(service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น')).rejects.toThrow(/ผิดปกติ/);
    expectNothingWritten();
  });

  // ── G6 ────────────────────────────────────────────────────────────────────
  it('G6: ใบขายมาจากออเดอร์ออนไลน์ → ปฏิเสธ', async () => {
    tx.sale.findUnique.mockResolvedValue({ ...CASH_SALE, onlineOrderId: 'oo-1' });
    await expect(service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น')).rejects.toThrow(/ออเดอร์ออนไลน์/);
    expectNothingWritten();
  });

  // ── G7 ────────────────────────────────────────────────────────────────────
  it('G7: มีใบซ่อมที่ยังเปิดอยู่บนเครื่องของใบขายนี้ → ปฏิเสธ', async () => {
    tx.repairTicket.findFirst.mockResolvedValue({
      ticketNumber: 'RT-20260801-0001',
      status: 'IN_PROGRESS',
    });
    await expect(service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น')).rejects.toThrow(/ใบซ่อม/);
    expectNothingWritten();
  });

  it('G7: ตรวจใบซ่อมด้วย productId ของทั้งสินค้าหลักและของแถม + exclude สถานะที่ปิดแล้ว', async () => {
    await service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น');
    expect(tx.repairTicket.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          productId: { in: ['p1', 'p2'] },
          deletedAt: null,
          status: { notIn: ['CLOSED', 'CANCELLED', 'REPLACED'] },
        }),
      }),
    );
  });

  // ── G5 ────────────────────────────────────────────────────────────────────
  it('G5: ของแถมถูกผูกไปที่อื่นแล้ว (สถานะไม่ตรงกับที่ใบขายตั้งไว้) → ปฏิเสธทั้งใบ', async () => {
    tx.product.findMany.mockResolvedValue([
      { id: 'p1', status: 'SOLD_CASH', deletedAt: null },
      { id: 'p2', status: 'SOLD_INSTALLMENT', deletedAt: null },
    ]);
    await expect(service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expectNothingWritten();
  });

  // สเปค §2 G5 สั่งให้ข้อความ "ระบุชื่อสินค้าและสถานะปัจจุบันของชิ้นที่ติด" — สถานะอย่างเดียว
  // ไม่พอเมื่อใบขายมีของแถมหลายชิ้น (ผู้ใช้ไล่เปิดทีละเครื่องเองไม่ได้ว่าชิ้นไหนติด)
  it('G5: ข้อความบอก **ชื่อ** ของชิ้นที่ติด ไม่ใช่แค่สถานะ (ใบขายมีหลายเครื่อง)', async () => {
    tx.product.findMany.mockResolvedValue([
      { id: 'p1', name: 'iPhone 15 128GB', status: 'SOLD_CASH', deletedAt: null },
      { id: 'p2', name: 'หูฟัง AirPods ของแถม', status: 'SOLD_INSTALLMENT', deletedAt: null },
    ]);
    await expect(service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น')).rejects.toThrow(
      /หูฟัง AirPods ของแถม/,
    );
    expectNothingWritten();
  });

  // ── G5 regression: ของแถมเป็น SOLD_CASH เสมอ แม้ในใบขายผ่านไฟแนนซ์ภายนอก ──
  // `markBundleProductsSold` hardcode SOLD_CASH และถูกเรียกจากทั้งสองเส้นทาง ขณะที่
  // สินค้าหลักของ EXTERNAL_FINANCE เป็น SOLD_INSTALLMENT ⇒ ใบเดียวมีสองสถานะ
  // ถ้าใช้ expectedStatus ตัวเดียวทั้งใบ ด่านจะบล็อกของแถมด้วยเหตุผลที่ไม่จริง
  it('G5: ใบขายผ่านไฟแนนซ์ภายนอกที่มีของแถม → สินค้าหลัก SOLD_INSTALLMENT + ของแถม SOLD_CASH ต้องผ่านทั้งคู่', async () => {
    tx.sale.findUnique.mockResolvedValue({ ...EXT_SALE, bundleProductIds: ['p8'] });
    tx.product.findMany.mockResolvedValue([
      { id: 'p9', status: 'SOLD_INSTALLMENT', deletedAt: null },
      { id: 'p8', status: 'SOLD_CASH', deletedAt: null },
    ]);
    tx.financeReceivable.findFirst.mockResolvedValue({
      id: 'fr-1',
      status: 'PENDING',
      receivedAmount: null,
      financeCompany: 'KTC',
    });
    tx.salesCommission.findMany.mockResolvedValue([]);
    tx.journalEntry.findMany.mockReset().mockResolvedValue([]);

    const res = await service.voidSale('s2', 'u1', 'คีย์ผิดบริษัทไฟแนนซ์');
    expect(res.restoredProductIds).toEqual(['p9', 'p8']);
    expect(tx.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['p9', 'p8'] } } }),
    );
  });

  it('G5: ของแถมของใบขายผ่านไฟแนนซ์ภายนอกกลายเป็น SOLD_INSTALLMENT (มีคนเอาไปเปิดสัญญาต่อ) → ปฏิเสธ', async () => {
    tx.sale.findUnique.mockResolvedValue({ ...EXT_SALE, bundleProductIds: ['p8'] });
    tx.product.findMany.mockResolvedValue([
      { id: 'p9', status: 'SOLD_INSTALLMENT', deletedAt: null },
      { id: 'p8', status: 'SOLD_INSTALLMENT', deletedAt: null },
    ]);
    await expect(service.voidSale('s2', 'u1', 'คีย์ผิดรุ่น')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expectNothingWritten();
  });

  it('G5: ขายผ่านไฟแนนซ์ภายนอกใช้ expectedStatus = SOLD_INSTALLMENT (ไม่ถูกตารางกลางบล็อกตัวเอง)', async () => {
    tx.sale.findUnique.mockResolvedValue({ ...EXT_SALE });
    tx.product.findMany.mockResolvedValue([
      { id: 'p9', status: 'SOLD_INSTALLMENT', deletedAt: null },
    ]);
    tx.salesCommission.findMany.mockResolvedValue([]);
    tx.journalEntry.findMany.mockReset().mockResolvedValue([]);
    await expect(service.voidSale('s2', 'u1', 'คีย์ผิดบริษัทไฟแนนซ์')).resolves.toBeDefined();
  });

  // ── G3 ────────────────────────────────────────────────────────────────────
  it('G3: ไฟแนนซ์ภายนอกโอนเงินมาแล้ว → ปฏิเสธ', async () => {
    tx.sale.findUnique.mockResolvedValue({ ...EXT_SALE });
    tx.product.findMany.mockResolvedValue([
      { id: 'p9', status: 'SOLD_INSTALLMENT', deletedAt: null },
    ]);
    tx.financeReceivable.findFirst.mockResolvedValue({
      id: 'fr-1',
      status: 'RECEIVED',
      receivedAmount: new Decimal(5000),
      financeCompany: 'KTC',
    });
    await expect(service.voidSale('s2', 'u1', 'คีย์ผิดรุ่น')).rejects.toThrow(/ไฟแนนซ์/);
    expectNothingWritten();
  });

  it('G3: สถานะยัง PENDING แต่มีเงินเข้าบางส่วน → ปฏิเสธ', async () => {
    tx.sale.findUnique.mockResolvedValue({ ...EXT_SALE });
    tx.product.findMany.mockResolvedValue([
      { id: 'p9', status: 'SOLD_INSTALLMENT', deletedAt: null },
    ]);
    tx.financeReceivable.findFirst.mockResolvedValue({
      id: 'fr-1',
      status: 'PENDING',
      receivedAmount: new Decimal(1),
      financeCompany: 'KTC',
    });
    await expect(service.voidSale('s2', 'u1', 'คีย์ผิดรุ่น')).rejects.toThrow(/ไฟแนนซ์/);
    expectNothingWritten();
  });

  // ── G4 ────────────────────────────────────────────────────────────────────
  it('G4: ค่าคอมจ่ายแล้ว → ปฏิเสธ', async () => {
    tx.salesCommission.findMany.mockResolvedValue([
      { id: 'c1', status: 'PAID', period: '2026-07' },
    ]);
    await expect(service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น')).rejects.toThrow(/ค่าคอม/);
    expectNothingWritten();
  });

  // ── G4b — รอบจ่ายค่าคอม (`CommissionPayout`) ────────────────────────────────
  // `markPayoutPaid` (commission.service.ts) อัปเดต **เฉพาะแถว CommissionPayout**
  // ไม่แตะ `SalesCommission.status` เลย ⇒ พนักงานรับเงินจริงไปแล้วแต่ค่าคอมยัง PENDING
  // ⇒ ด่านที่ดูแค่ `SalesCommission.status` ปิดประตูเงินได้แค่บานเดียว
  it('G4b: ค่าคอมอยู่ในรอบจ่ายที่จ่ายเงินแล้ว (SalesCommission ยัง PENDING) → ปฏิเสธ', async () => {
    tx.commissionPayout.findFirst.mockResolvedValue({ period: '2026-08', status: 'PAID' });
    await expect(service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น')).rejects.toThrow(/รอบจ่าย/);
    expectNothingWritten();
  });

  it('G4b: รอบจ่ายสถานะ DRAFT ก็บล็อก — ยอดในรอบจะค้างเกินจริง (generatePayouts ข้ามรอบที่มีอยู่แล้ว)', async () => {
    tx.commissionPayout.findFirst.mockResolvedValue({ period: '2026-08', status: 'DRAFT' });
    await expect(service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expectNothingWritten();
  });

  it('G4b: ค้นรอบจ่ายด้วยคู่ (salespersonId, period) ของค่าคอมที่เจอ + exclude เฉพาะ CANCELLED', async () => {
    await service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น');
    expect(tx.commissionPayout.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          status: { notIn: ['CANCELLED'] },
          OR: [{ salespersonId: 'sp1', period: '2026-08' }],
        }),
      }),
    );
  });

  it('G4b: ไม่มีค่าคอมเลย → ไม่ต้องไปถามรอบจ่าย', async () => {
    tx.salesCommission.findMany.mockResolvedValue([]);
    await service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น');
    expect(tx.commissionPayout.findFirst).not.toHaveBeenCalled();
  });

  // ── G4 — สถานะค่าคอมที่เงินออกไปแล้ว ────────────────────────────────────────
  it('G4: PARTIALLY_CLAWED_BACK (เงินออกแล้ว เรียกคืนบางส่วน) → ปฏิเสธ ไม่ใช่ผ่านเงียบ ๆ', async () => {
    tx.salesCommission.findMany.mockResolvedValue([
      { id: 'c1', status: 'PARTIALLY_CLAWED_BACK', period: '2026-08', salespersonId: 'sp1' },
    ]);
    await expect(service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expectNothingWritten();
  });

  // สเปค §3 ข้อ 4: การเรียกคืนต้องครอบ **ทั้ง PENDING และ APPROVED**
  it('ค่าคอมสถานะ APPROVED → เรียกคืนด้วย (ไม่ใช่แค่ PENDING)', async () => {
    tx.salesCommission.findMany.mockResolvedValue([
      { id: 'c1', status: 'PENDING', period: '2026-08', salespersonId: 'sp1' },
      { id: 'c2', status: 'APPROVED', period: '2026-08', salespersonId: 'sp1' },
    ]);
    await service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น');
    expect(tx.salesCommission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['c1', 'c2'] } },
        data: { status: 'CLAWED_BACK' },
      }),
    );
  });

  // ── ชนิดการขายที่ยังไม่รู้จัก (ด่านกัน 500) ─────────────────────────────────
  it('ชนิดการขายที่ยังไม่รู้จัก → ปฏิเสธเป็นข้อความไทย ไม่ปล่อยไปตาย 500 ที่ด่านสินค้า', async () => {
    tx.sale.findUnique.mockResolvedValue({ ...CASH_SALE, saleType: 'CONSIGNMENT' });
    await expect(service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expectNothingWritten();
  });

  // ── G2 ────────────────────────────────────────────────────────────────────
  //
  // mirror ลงวันที่ **วันนี้** เสมอ (`createAndPost` ตั้ง entryDate = postedAt = now)
  // ⇒ งวดที่ตรวจคืองวดปัจจุบัน ซึ่ง `period_grace_days` เปิดค้างไว้จนพ้นสิ้นเดือน
  // ด่านนี้จึงทำงานจริงเฉพาะปลายหน้าต่าง grace — ตรึงเวลาไว้ตรงนั้นเพื่อพิสูจน์ว่ามันต่อสายจริง
  it('G2: งวดบัญชีของบริษัทที่จะโพสต์กลับรายการปิดแล้ว (พ้น grace) → ปฏิเสธ ไม่กลับรายการ', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 31, 10, 0, 0)); // 31 ส.ค. 2026 10:00 น.
    try {
      tx.accountingPeriod.findUnique.mockResolvedValue({ status: 'CLOSED' });
      tx.systemConfig.findUnique.mockResolvedValue({ value: '0' }); // grace 0 วัน
      await expect(service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น')).rejects.toThrow(/งวดที่ปิดแล้ว/);
      expectNothingWritten();
    } finally {
      jest.useRealTimers();
    }
  });

  it('G2: ตรวจงวดของทุกบริษัทที่มี JE ของใบขายนี้ (ไม่ใช่แค่ใบแรก)', async () => {
    tx.journalEntry.findMany
      .mockReset()
      .mockResolvedValueOnce([
        { id: 'je-1', companyId: 'shop-co' },
        { id: 'je-2', companyId: 'finance-co' },
      ])
      .mockResolvedValueOnce([{ entryNumber: 'JE-202608-0099' }]);
    await service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น');
    const checkedCompanies = tx.accountingPeriod.findUnique.mock.calls.map(
      (c: [{ where: { companyId_year_month: { companyId: string } } }]) =>
        c[0].where.companyId_year_month.companyId,
    );
    expect(new Set(checkedCompanies)).toEqual(new Set(['shop-co', 'finance-co']));
  });

  it('ไม่มี JE (ขายผ่านไฟแนนซ์ภายนอก) → ไม่เรียกด่านงวดบัญชีเลย', async () => {
    tx.sale.findUnique.mockResolvedValue({ ...EXT_SALE });
    tx.product.findMany.mockResolvedValue([
      { id: 'p9', status: 'SOLD_INSTALLMENT', deletedAt: null },
    ]);
    tx.salesCommission.findMany.mockResolvedValue([]);
    tx.journalEntry.findMany.mockReset().mockResolvedValue([]);
    await service.voidSale('s2', 'u1', 'คีย์ผิดบริษัทไฟแนนซ์');
    expect(tx.accountingPeriod.findUnique).not.toHaveBeenCalled();
  });

  // ── สำเร็จ: ขายสด ─────────────────────────────────────────────────────────
  it('สำเร็จ: คืนสินค้าหลัก+ของแถมเป็น IN_STOCK, กลับรายการ JE, ค่าคอม CLAWED_BACK, เขียน audit ใน tx', async () => {
    const res = await service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น');

    expect(tx.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['p1', 'p2'] } },
        data: { status: 'IN_STOCK' },
      }),
    );
    expect(reversalTemplate.reverse).toHaveBeenCalledWith(
      expect.objectContaining({
        sweepBy: { path: 'saleId', value: 's1' },
        flowLabel: 'shop-cash-sale-void',
      }),
      tx,
    );
    expect(tx.salesCommission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CLAWED_BACK' } }),
    );
    expect(tx.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        // `deletedAt` คือหัวใจของฟีเจอร์ — G1 idempotency และ "ใบที่ยกเลิกหายจากรายงาน"
        // (สเปค §4) แขวนอยู่กับมันทั้งคู่ ⇒ ต้องปักไว้ ไม่ใช่ปล่อยให้ตัดออกแล้วเทสยังเขียว
        data: expect.objectContaining({
          voidReason: 'คีย์ผิดรุ่น',
          voidedById: 'u1',
          deletedAt: expect.any(Date),
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'SALE_VOIDED',
          entity: 'sale',
          entityId: 's1',
          userId: 'u1',
        }),
      }),
    );
    expect(res.saleNumber).toBe('SA-0001');
    expect(res.restoredProductIds).toEqual(['p1', 'p2']);
    expect(res.reversalEntryNumbers).toEqual(['JE-202608-0099']);
  });

  it('สำเร็จ: audit เก็บเลขที่ใบกลับรายการ + รหัสค่าคอมที่เรียกคืน', async () => {
    await service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น');
    const audit = tx.auditLog.create.mock.calls[0][0].data.newValue;
    expect(audit.reversalEntryNumbers).toEqual(['JE-202608-0099']);
    expect(audit.commissionIds).toEqual(['c1']);
    expect(audit.reason).toBe('คีย์ผิดรุ่น');
  });

  // ── สำเร็จ: ขายผ่านไฟแนนซ์ภายนอก ──────────────────────────────────────────
  it('ขายผ่านไฟแนนซ์ภายนอก: ไม่มี JE ให้กลับรายการ + ยกเลิก FinanceReceivable + ไม่แตะค่าคอม', async () => {
    tx.sale.findUnique.mockResolvedValue({ ...EXT_SALE });
    tx.product.findMany.mockResolvedValue([
      { id: 'p9', status: 'SOLD_INSTALLMENT', deletedAt: null },
    ]);
    tx.financeReceivable.findFirst.mockResolvedValue({
      id: 'fr-1',
      status: 'PENDING',
      receivedAmount: null,
      financeCompany: 'KTC',
    });
    tx.salesCommission.findMany.mockResolvedValue([]);
    tx.journalEntry.findMany.mockReset().mockResolvedValue([]);

    const res = await service.voidSale('s2', 'u1', 'คีย์ผิดบริษัทไฟแนนซ์');

    expect(tx.financeReceivable.updateMany).toHaveBeenCalled();
    expect(tx.salesCommission.updateMany).not.toHaveBeenCalled();
    expect(reversalTemplate.reverse).not.toHaveBeenCalled();
    expect(res.reversalEntryNumbers).toEqual([]);
    expect(tx.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'IN_STOCK' } }),
    );
  });

  // ── P2034 ─────────────────────────────────────────────────────────────────
  it('P2034 (SSI race) → 409 ไทย ไม่ใช่ raw 500', async () => {
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('write conflict', {
        code: 'P2034',
        clientVersion: 'test',
      }),
    );
    await expect(service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('ทรานแซกชันเป็น Serializable', async () => {
    await service.voidSale('s1', 'u1', 'คีย์ผิดรุ่น');
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
  });
});
