import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { poJournalTestProviders } from './po-journal.test-helpers';

describe('PurchaseOrdersService.rejectQC', () => {
  let service: PurchaseOrdersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const buildTx = (products: { id: string; status: string; name: string; poId?: string | null }[], bookedProductIds: string[] = []) => {
    const tx = {
      // ก้อน 2: หักมัดจำตอนรับของถามก่อนว่าเคยมัดจำไหม — spec นี้ไม่มีมัดจำ
      purchaseOrderPayment: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      product: {
        findMany: jest.fn().mockResolvedValue(products),
        updateMany: jest.fn().mockResolvedValue({ count: products.length }),
      },
      goodsReceivingItem: {
        findMany: jest.fn().mockResolvedValue(bookedProductIds.map((productId) => ({ productId }))),
      },
      // Todo ตีกลับ (2026-10-11): ใบสั่งซื้อของเครื่อง + รายการบัญชีของใบ (มัดจำค้าง) + งานที่เปิดอยู่
      purchaseOrder: {
        findUnique: jest.fn().mockResolvedValue({ id: 'po-1', poNumber: 'PO-2026-10-001', netAmount: '15000', status: 'PARTIALLY_RECEIVED', items: [{ quantity: 5, receivedQty: 3 }] }),
      },
      journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
      todo: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 't1' }) },
    };
    return tx;
  };

  const build = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }, ...poJournalTestProviders().providers],
    }).compile();
    return module.get<PurchaseOrdersService>(PurchaseOrdersService);
  };

  it('soft-deletes PHOTO_PENDING products and returns the count', async () => {
    const tx = buildTx([
      { id: 'p1', status: 'PHOTO_PENDING', name: 'iPhone' },
      { id: 'p2', status: 'PHOTO_PENDING', name: 'iPhone 2' },
    ]);
    prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    service = await build();

    const res = await service.rejectQC(['p1', 'p2'], 'จอแตก', 'owner-1');
    expect(res.rejected).toBe(2);
    expect(tx.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // เงื่อนไขสถานะอยู่ในคำสั่งเขียนเอง — ค่าที่อ่านไว้ก่อนหน้าอาจเก่าไปแล้วเมื่ออีกคำขอ commit ก่อน
        where: { id: { in: ['p1', 'p2'] }, status: 'PHOTO_PENDING', deletedAt: null },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  // คำตัดสินเจ้าของ 2026-10-06/11 (Todo ตีกลับ): เครื่องจากใบที่มัดจำไว้ถูกตีกลับ → มัดจำส่วนนั้นค้างโดยไม่มีเจ้าหนี้มาหัก → แจ้งฝ่ายบัญชี
  describe('งานแจ้งฝ่ายบัญชีเมื่อใบมีมัดจำค้าง', () => {
    const depositLines = [{ accountCode: 'S11-4201', debit: '3000', credit: '0' }, { accountCode: 'S11-1202', debit: '0', credit: '3000' }];

    it('ใบมีมัดจำค้าง → สร้าง Todo หนึ่งใบต่อใบสั่งซื้อ (แท็ก po-deposit-reject + po:<id>) ด้วยผู้กดเป็นผู้สร้าง', async () => {
      const tx = buildTx([
        { id: 'p1', status: 'PHOTO_PENDING', name: 'iPhone', poId: 'po-1' },
        { id: 'p2', status: 'PHOTO_PENDING', name: 'iPhone 2', poId: 'po-1' },
      ]);
      tx.journalEntry.findMany.mockResolvedValue([{ lines: depositLines }]);
      prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
      service = await build();

      const res = await service.rejectQC(['p1', 'p2'], 'จอแตก', 'bm-1');
      expect(res.depositTodosCreated).toEqual(['PO-2026-10-001']);
      expect(tx.todo.create).toHaveBeenCalledTimes(1);
      const data = tx.todo.create.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({ priority: 'MEDIUM', tags: ['po-deposit-reject', 'po:po-1'], createdById: 'bm-1' }));
      expect(data.title).toMatch(/PO-2026-10-001.*2 ชิ้น.*3,000\.00/);
      expect(data.description).toMatch(/รับของตามใบเดิม/);
      expect(data.description).toMatch(/กด "ปิดใบ รับไม่ครบ"/);
    });

    // ผู้ตรวจอิสระ 2026-10-11 ข้อ 4: เครื่องที่ตีกลับยังนับเป็นรับแล้ว — ใบที่นับว่ารับครบจึงรับเพิ่ม/ปิดใบไม่ได้ ห้ามชี้ปุ่มที่กดไม่ได้
    it('ใบนับว่ารับครบแล้ว (FULLY_RECEIVED) → งานบอกตรง ๆ ว่ายังไม่มีเมนู ไม่ชี้ปุ่มรับของ/ปิดใบ · ใบที่ปิด/ยกเลิกแล้ว → ไม่มีงาน', async () => {
      const full = buildTx([{ id: 'p1', status: 'PHOTO_PENDING', name: 'iPhone', poId: 'po-1' }]);
      full.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', poNumber: 'PO-2026-10-001', netAmount: '15000', status: 'FULLY_RECEIVED', items: [{ quantity: 5, receivedQty: 5 }] });
      full.journalEntry.findMany.mockResolvedValue([{ lines: depositLines }]);
      prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(full)) };
      service = await build();
      await service.rejectQC(['p1'], 'จอแตก', 'bm-1');
      const desc = full.todo.create.mock.calls[0][0].data.description as string;
      expect(desc).toMatch(/ยังไม่มีเมนู/);
      expect(desc).not.toMatch(/กด "ปิดใบ รับไม่ครบ"/);
      expect(desc).not.toMatch(/รับของตามใบเดิม/);

      for (const status of ['CLOSED_SHORT', 'CANCELLED']) {
        const closed = buildTx([{ id: 'p1', status: 'PHOTO_PENDING', name: 'iPhone', poId: 'po-1' }]);
        closed.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', poNumber: 'PO-2026-10-001', netAmount: '15000', status, items: [] });
        closed.journalEntry.findMany.mockResolvedValue([{ lines: depositLines }]);
        prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(closed)) };
        service = await build();
        await service.rejectQC(['p1'], 'จอแตก', 'bm-1');
        expect(closed.todo.create).not.toHaveBeenCalled();
      }
    });

    it('มีงานเปิดอยู่แล้ว → ไม่สร้างซ้ำ · ใบไม่มีมัดจำค้าง / เครื่องไม่ได้มาจากใบสั่งซื้อ → ไม่มีงาน', async () => {
      const open = buildTx([{ id: 'p1', status: 'PHOTO_PENDING', name: 'iPhone', poId: 'po-1' }]);
      open.journalEntry.findMany.mockResolvedValue([{ lines: depositLines }]);
      open.todo.findFirst.mockResolvedValue({ id: 'existing' });
      prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(open)) };
      service = await build();
      expect((await service.rejectQC(['p1'], 'จอแตก', 'bm-1')).depositTodosCreated).toEqual([]);
      expect(open.todo.create).not.toHaveBeenCalled();

      const noDeposit = buildTx([{ id: 'p1', status: 'PHOTO_PENDING', name: 'iPhone', poId: 'po-1' }]);
      prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(noDeposit)) };
      service = await build();
      expect((await service.rejectQC(['p1'], 'จอแตก', 'bm-1')).depositTodosCreated).toEqual([]);
      expect(noDeposit.todo.findFirst).not.toHaveBeenCalled();

      const noPo = buildTx([{ id: 'p1', status: 'PHOTO_PENDING', name: 'เทิร์น', poId: null }]);
      prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(noPo)) };
      service = await build();
      await service.rejectQC(['p1'], 'จอแตก', 'bm-1');
      expect(noPo.purchaseOrder.findUnique).not.toHaveBeenCalled();
    });
  });

  it('rejects when no productIds are given', async () => {
    prisma = { $transaction: jest.fn() };
    service = await build();
    await expect(service.rejectQC([], 'x', 'owner-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects when a product is not in the photo queue (IN_STOCK, legacy QC_PENDING)', async () => {
    for (const status of ['IN_STOCK', 'QC_PENDING']) {
      const tx = buildTx([{ id: 'p1', status, name: 'Sold-in' }]);
      prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
      service = await build();
      await expect(service.rejectQC(['p1'], 'late', 'owner-1')).rejects.toThrow(/รอถ่ายรูป/);
      expect(tx.product.updateMany).not.toHaveBeenCalled();
    }
  });

  // คำตอบฝ่ายบัญชี 2026-09-30 ข้อ 8: เครื่องที่รอถ่ายรูปยังไม่ลงบัญชี จึงตีกลับได้โดยไม่แตะบัญชี —
  // แต่เครื่องที่ลงบัญชีรับเข้าคลังไปแล้ว (เคยอยู่ในคลังแล้วถูกเปลี่ยนกลับมารอถ่ายรูป) ลบทิ้งไม่ได้
  it('ปฏิเสธเครื่องที่ลงบัญชีรับเข้าคลังแล้ว — ลบทิ้งจะเหลือสินค้าคงคลังและเจ้าหนี้ค้างโดยไม่มีเครื่อง', async () => {
    const tx = buildTx(
      [
        { id: 'p1', status: 'PHOTO_PENDING', name: 'iPhone รอถ่ายรูป' },
        { id: 'p2', status: 'PHOTO_PENDING', name: 'iPhone เคยเข้าคลัง' },
      ],
      ['p2'],
    );
    prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    service = await build();

    await expect(service.rejectQC(['p1', 'p2'], 'จอแตก', 'owner-1')).rejects.toThrow(/ลงบัญชีรับเข้าคลังแล้ว.*iPhone เคยเข้าคลัง/);
    expect(tx.goodsReceivingItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ productId: { in: ['p1', 'p2'] }, journalEntryId: { not: null } }) }),
    );
    // ตรวจหลังคำสั่งลบ (ถือล็อกแถวสินค้าแล้ว) — การลบถูกย้อนกลับเพราะโยนใน tx เดียวกัน (ผลตรวจทานอิสระรอบ 3)
    expect(tx.goodsReceivingItem.findMany.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.product.updateMany.mock.invocationCallOrder[0],
    );
  });

  // ผลตรวจทานอิสระ 2026-09-30: กด "ไม่รับเข้าคลัง" พร้อมกับกดยืนยันรูปครบ — ฝั่งยืนยันรูป commit ก่อน
  // (เครื่องเข้าคลัง + ลงบัญชีแล้ว) แต่ฝั่งนี้อ่านค่าเก่าไว้ว่ายังรอถ่ายรูป ⇒ คำสั่งลบต้องไม่โดนเครื่องนั้น
  it('เครื่องเพิ่งถูกยืนยันรูปเข้าคลังระหว่างทำรายการ (ลบได้ไม่ครบ) → ปฏิเสธทั้งชุด ให้รีเฟรช', async () => {
    const tx = buildTx([
      { id: 'p1', status: 'PHOTO_PENDING', name: 'iPhone' },
      { id: 'p2', status: 'PHOTO_PENDING', name: 'iPhone 2' },
    ]);
    tx.product.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    service = await build();

    const error = await service.rejectQC(['p1', 'p2'], 'จอแตก', 'owner-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toMatch(/รีเฟรชหน้าจอ/);
  });
});
