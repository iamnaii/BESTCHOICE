import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReceivingAcceptanceJournal } from '../purchase-orders/services/receiving-acceptance-journal';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import {
  STOCK_ADJUSTMENT_TODO_TAG,
  StockAdjustmentsService,
  adjustmentTodoKey,
} from './stock-adjustments.service';

/**
 * ก้อน 3 (2026-10-05) — คำขอตัดสินค้า: ผู้ขอ (SALES/BM/OWNER สาขาตัวเอง) ส่งคำขอ → เครื่องถูกพักขายด้วย
 * สถานะ ADJUSTMENT_PENDING → Todo ถึงเจ้าของ → เจ้าของอนุมัติ/ไม่อนุมัติ (Task 6). ที่นี่ทดสอบขั้นคำขอ/ยกเลิก/
 * preview ด้วย mock — การลงบัญชีจริงทดสอบกับฐานจริงที่ `__tests__/stock-adjustment.integration.spec.ts`.
 */
let bookIfPending: jest.SpyInstance;
beforeEach(() => {
  bookIfPending = jest.spyOn(ReceivingAcceptanceJournal.prototype, 'bookIfPending').mockResolvedValue(null);
});
afterEach(() => bookIfPending.mockRestore());

const OWNER = { id: 'owner-1', role: 'OWNER', branchId: null };
const SALES_B1 = { id: 'sales-1', role: 'SALES', branchId: 'branch-1' };
const SALES_B2 = { id: 'sales-2', role: 'SALES', branchId: 'branch-2' };

function baseProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'iPhone 15',
    brand: 'Apple',
    model: 'iPhone 15',
    imeiSerial: '350000000000001',
    serialNumber: null,
    category: 'PHONE_NEW',
    costPrice: new Prisma.Decimal('12000.00'),
    status: 'IN_STOCK',
    branchId: 'branch-1',
    deletedAt: null,
    checklistResults: null,
    branch: { id: 'branch-1', name: 'ลาดพร้าว' },
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function build(product: Record<string, unknown> | null = baseProduct()) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    product: {
      findUnique: jest.fn().mockResolvedValue(product),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...product, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    stockAdjustment: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'adj-1',
          ...data,
          product: { id: 'p1', name: 'iPhone 15', brand: 'Apple', model: 'iPhone 15', imeiSerial: '350000000000001', costPrice: new Prisma.Decimal('12000.00'), category: 'PHONE_NEW' },
          branch: { id: 'branch-1', name: 'ลาดพร้าว' },
          adjustedBy: { id: data.adjustedById, name: 'ผู้ขอ' },
          approvedBy: null,
          rejectedBy: null,
          canceledBy: null,
        }),
      ),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'adj-1', ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    todo: {
      create: jest.fn().mockResolvedValue({ id: 'todo-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'owner-1' }) },
    contract: { findFirst: jest.fn().mockResolvedValue(null) },
    productReservation: { findFirst: jest.fn().mockResolvedValue(null) },
    onlineOrder: { findFirst: jest.fn().mockResolvedValue(null) },
    goodsReceivingItem: { findFirst: jest.fn().mockResolvedValue(null) },
    journalEntry: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    chartOfAccount: {
      findMany: jest.fn().mockResolvedValue([
        { code: 'S53-1102', name: 'ขาดทุนจากสินค้าสูญหาย/เสียหาย' },
        { code: 'S11-2001', name: 'สินค้าคงคลัง-มือถือใหม่' },
      ]),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
  };
  prisma.$transaction = jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb(prisma));

  const template = { execute: jest.fn(), reverse: jest.fn() };
  const companies = { getShopCompanyId: jest.fn().mockResolvedValue('shop-co') };
  const storage = {
    upload: jest.fn().mockImplementation((key: string) => Promise.resolve(key)),
    delete: jest.fn().mockResolvedValue(undefined),
    getSignedDownloadUrl: jest.fn().mockImplementation((key: string) => Promise.resolve(`https://signed/${key}`)),
  };
  const numbers = { next: jest.fn().mockResolvedValue('SA-20261005-0001') };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new StockAdjustmentsService(
    prisma,
    template as never,
    new ShopAccountResolver(prisma),
    companies as never,
    storage as never,
    numbers as never,
    audit as never,
  );
  return { prisma, template, companies, storage, numbers, audit, service };
}

const jpeg = (name = 'a.jpg') =>
  ({
    originalname: name,
    mimetype: 'image/jpeg',
    size: 4,
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00]),
  }) as unknown as Express.Multer.File;

describe('StockAdjustmentsService.createRequest', () => {
  it('(a) SALES คนละสาขากับเครื่อง → 403 ไม่สร้างใบ', async () => {
    const { service, prisma } = build();
    await expect(
      service.createRequest({ productId: 'p1', reason: 'LOST' }, [], SALES_B2),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.stockAdjustment.create).not.toHaveBeenCalled();
  });

  it('(a2) BM/SALES ที่ไม่มี branchId ติดตัว → 403 (fail-closed)', async () => {
    const { service } = build();
    await expect(
      service.createRequest({ productId: 'p1', reason: 'LOST' }, [], { id: 's', role: 'SALES', branchId: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('(b) LOST บนเครื่อง IN_STOCK → ใบ PENDING_APPROVAL + พักขายเครื่อง + Todo ถึงเจ้าของ + ไม่ลงบัญชี', async () => {
    const { service, prisma, template, audit } = build();
    const view = await service.createRequest({ productId: 'p1', reason: 'LOST', notes: 'หาไม่พบตอนนับสต๊อก' }, [], SALES_B1);

    expect(prisma.stockAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'p1',
          reason: 'LOST',
          previousStatus: 'IN_STOCK',
          status: 'PENDING_APPROVAL',
          requestNumber: 'SA-20261005-0001',
          adjustedById: 'sales-1',
          branchId: 'branch-1',
          photos: [],
        }),
      }),
    );
    expect(prisma.product.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'ADJUSTMENT_PENDING' } });
    expect(prisma.todo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priority: 'HIGH',
          assigneeId: 'owner-1',
          createdById: 'sales-1',
          tags: [STOCK_ADJUSTMENT_TODO_TAG, adjustmentTodoKey('SA-20261005-0001')],
          title: expect.stringContaining('SA-20261005-0001'),
        }),
      }),
    );
    expect(template.execute).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STOCK_ADJUSTMENT_REQUESTED', userId: 'sales-1', entity: 'stock_adjustment' }),
    );
    expect(view.requestNumber).toBe('SA-20261005-0001');
  });

  it('(c) DAMAGED ไม่มีรูป → 400 ไม่สร้างใบ ไม่อัปโหลด', async () => {
    const { service, prisma, storage } = build();
    await expect(
      service.createRequest({ productId: 'p1', reason: 'DAMAGED' }, [], SALES_B1),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.stockAdjustment.create).not.toHaveBeenCalled();
  });

  it('(d) DAMAGED มีรูป → อัปโหลดเป็น key ใต้ stock-adjustments/ แล้วเก็บ key ไว้ในใบ', async () => {
    const { service, prisma, storage } = build();
    await service.createRequest({ productId: 'p1', reason: 'DAMAGED' }, [jpeg(), jpeg('b.jpg')], SALES_B1);
    expect(storage.upload).toHaveBeenCalledTimes(2);
    const [key, buf, mime] = storage.upload.mock.calls[0];
    expect(key).toMatch(/^stock-adjustments\/\d{8}\/[0-9a-f-]{36}\.jpg$/);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(mime).toBe('image/jpeg');
    const photos = prisma.stockAdjustment.create.mock.calls[0][0].data.photos;
    expect(photos).toHaveLength(2);
    expect(photos[0]).toMatch(/^stock-adjustments\//);
    expect(photos[0]).not.toMatch(/^data:/);
  });

  it('(d2) ไฟล์ที่ไม่ใช่รูป JPEG/PNG/WebP → 400 ไม่อัปโหลด', async () => {
    const { service, storage } = build();
    const fake = { ...jpeg(), mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake payload') } as unknown as Express.Multer.File;
    await expect(service.createRequest({ productId: 'p1', reason: 'DAMAGED' }, [fake], SALES_B1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('(d3) tx ล้มหลังอัปโหลดรูป → ลบ key ทิ้ง (best-effort)', async () => {
    const { service, prisma, storage } = build();
    prisma.stockAdjustment.create.mockRejectedValue(new Error('db down'));
    await expect(service.createRequest({ productId: 'p1', reason: 'DAMAGED' }, [jpeg()], SALES_B1)).rejects.toThrow('db down');
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });

  it('(e) CORRECTION → ใบ PENDING แต่ไม่พักขายเครื่อง', async () => {
    const { service, prisma } = build();
    await service.createRequest({ productId: 'p1', reason: 'CORRECTION', notes: 'แก้สี' }, [], SALES_B1);
    expect(prisma.stockAdjustment.create).toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.todo.create).toHaveBeenCalled();
  });

  it('(f) FOUND บน SOLD_INSTALLMENT (ไม่ถูกลบ) → 400 จาก allow-list เดิม', async () => {
    const { service, prisma } = build(baseProduct({ status: 'SOLD_INSTALLMENT' }));
    await expect(service.createRequest({ productId: 'p1', reason: 'FOUND' }, [], OWNER)).rejects.toThrow(/พบของ/);
    expect(prisma.stockAdjustment.create).not.toHaveBeenCalled();
  });

  it('(f2) FOUND บนเครื่อง LOST ที่ถูกลบแล้ว → สร้างคำขอได้ (ไม่กรอง deletedAt) และไม่พักขาย', async () => {
    const { service, prisma } = build(baseProduct({ status: 'LOST', deletedAt: new Date('2026-10-01') }));
    await service.createRequest({ productId: 'p1', reason: 'FOUND' }, [], OWNER);
    expect(prisma.stockAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reason: 'FOUND', previousStatus: 'LOST' }) }),
    );
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('(g) เครื่องมีคำขอ PENDING อยู่แล้ว → 409 ระบุเลขคำขอเดิม', async () => {
    const { service, prisma } = build();
    prisma.stockAdjustment.findFirst.mockResolvedValue({ id: 'adj-0', requestNumber: 'SA-20261004-0007', status: 'PENDING_APPROVAL' });
    await expect(service.createRequest({ productId: 'p1', reason: 'LOST' }, [], SALES_B1)).rejects.toThrow(/SA-20261004-0007/);
    expect(prisma.stockAdjustment.create).not.toHaveBeenCalled();
  });

  it('(g2) ชน partial unique (P2002) ตอน create → 409 ไม่ใช่ 500', async () => {
    const { service, prisma } = build();
    prisma.stockAdjustment.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(service.createRequest({ productId: 'p1', reason: 'LOST' }, [], SALES_B1)).rejects.toBeInstanceOf(ConflictException);
  });

  it('(g3) LOST บนเครื่อง SOLD_CASH → 400 บอกสถานะ', async () => {
    const { service } = build(baseProduct({ status: 'SOLD_CASH' }));
    await expect(service.createRequest({ productId: 'p1', reason: 'LOST' }, [], OWNER)).rejects.toThrow(/SOLD_CASH/);
  });

  it('(g4) WRITE_OFF บนเครื่อง DAMAGED (คงในสต๊อก) → ทำได้', async () => {
    const { service, prisma } = build(baseProduct({ status: 'DAMAGED' }));
    await service.createRequest({ productId: 'p1', reason: 'WRITE_OFF' }, [], OWNER);
    expect(prisma.stockAdjustment.create).toHaveBeenCalled();
    expect(prisma.product.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'ADJUSTMENT_PENDING' } });
  });

  it('(g5) LOST บนเครื่อง DAMAGED → 400 (เสียหายแล้วตัดจำหน่ายได้ทางเดียว)', async () => {
    const { service } = build(baseProduct({ status: 'DAMAGED' }));
    await expect(service.createRequest({ productId: 'p1', reason: 'LOST' }, [], OWNER)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('StockAdjustmentsService.cancel', () => {
  const pendingRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'adj-1',
    requestNumber: 'SA-20261005-0001',
    reason: 'LOST',
    status: 'PENDING_APPROVAL',
    previousStatus: 'PHOTO_PENDING',
    productId: 'p1',
    adjustedById: 'sales-1',
    ...overrides,
  });

  it('(h) คนอื่นที่ไม่ใช่ผู้ขอ/OWNER → 403', async () => {
    const { service, prisma } = build();
    prisma.stockAdjustment.findUnique.mockResolvedValue(pendingRow());
    await expect(service.cancel('adj-1', SALES_B2)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.stockAdjustment.update).not.toHaveBeenCalled();
  });

  it('(h2) ผู้ขอยกเลิกเอง → เครื่องกลับ previousStatus (PHOTO_PENDING) · ใบ CANCELED · Todo ปิด', async () => {
    const { service, prisma, audit } = build();
    prisma.stockAdjustment.findUnique.mockResolvedValue(pendingRow());
    await service.cancel('adj-1', SALES_B1);
    expect(prisma.$queryRaw).toHaveBeenCalled(); // FOR UPDATE
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'ADJUSTMENT_PENDING' },
      data: { status: 'PHOTO_PENDING' },
    });
    expect(prisma.stockAdjustment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'adj-1' },
        data: expect.objectContaining({ status: 'CANCELED', canceledById: 'sales-1' }),
      }),
    );
    expect(prisma.todo.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tags: { hasEvery: [STOCK_ADJUSTMENT_TODO_TAG, 'sa:SA-20261005-0001'] } }),
        data: expect.objectContaining({ status: 'DONE' }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'STOCK_ADJUSTMENT_CANCELED' }));
  });

  it('(h3) ใบที่ไม่ใช่ PENDING → 409', async () => {
    const { service, prisma } = build();
    prisma.stockAdjustment.findUnique.mockResolvedValue(pendingRow({ status: 'APPROVED' }));
    await expect(service.cancel('adj-1', OWNER)).rejects.toBeInstanceOf(ConflictException);
  });

  it('(h4) CORRECTION ยกเลิก → ไม่แตะสถานะเครื่อง', async () => {
    const { service, prisma } = build();
    prisma.stockAdjustment.findUnique.mockResolvedValue(pendingRow({ reason: 'CORRECTION', previousStatus: 'IN_STOCK' }));
    await service.cancel('adj-1', OWNER);
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });
});

describe('StockAdjustmentsService.preview', () => {
  it('(i) LOST + เครื่องลงบัญชีรับเข้าแล้ว → 2 บรรทัด Dr S53-1102 / Cr S11-2001 ที่ต้นทุน', async () => {
    const { service, prisma } = build();
    prisma.goodsReceivingItem.findFirst.mockResolvedValue({
      receivedCost: new Prisma.Decimal('12000.00'),
      journalEntryId: 'je-1',
      receiving: { grNumber: 'GR-20261001-001' },
    });
    prisma.journalEntry.findUnique.mockResolvedValue({ entryNumber: 'JE-202610-00012' });
    const p = await service.preview('p1', 'LOST', SALES_B1);
    expect(p.holdsProduct).toBe(true);
    expect(p.productStatusAfter).toBe('LOST');
    expect(p.requiresPhoto).toBe(false);
    expect(p.booked.booked).toBe(true);
    expect(p.inventoryAccountCode).toBe('S11-2001');
    expect(p.costAmount).toBe('12000.00');
    expect(p.journalLines).toEqual([
      { accountCode: 'S53-1102', name: 'ขาดทุนจากสินค้าสูญหาย/เสียหาย', debit: '12000.00', credit: '0.00' },
      { accountCode: 'S11-2001', name: 'สินค้าคงคลัง-มือถือใหม่', debit: '0.00', credit: '12000.00' },
    ]);
  });

  it('(i2) DAMAGED → ไม่มีบรรทัด + note ข7 + requiresPhoto', async () => {
    const { service } = build();
    const p = await service.preview('p1', 'DAMAGED', SALES_B1);
    expect(p.journalLines).toEqual([]);
    expect(p.journalNote).toMatch(/ข7|เสียหายคงในสต๊อก/);
    expect(p.requiresPhoto).toBe(true);
    expect(p.productStatusAfter).toBe('DAMAGED');
  });

  it('(i3) LOST แต่เครื่องไม่เคยลงบัญชีรับเข้า → ไม่มีบรรทัด + note แจ้งฝ่ายบัญชี', async () => {
    const { service } = build();
    const p = await service.preview('p1', 'LOST', SALES_B1);
    expect(p.booked.booked).toBe(false);
    expect(p.journalLines).toEqual([]);
    expect(p.journalNote).toMatch(/ฝ่ายบัญชี/);
  });

  it('(i4) CORRECTION → ไม่พักขาย ไม่เปลี่ยนสถานะ ไม่มีบรรทัด', async () => {
    const { service } = build();
    const p = await service.preview('p1', 'CORRECTION', SALES_B1);
    expect(p.holdsProduct).toBe(false);
    expect(p.productStatusAfter).toBeNull();
    expect(p.journalLines).toEqual([]);
  });

  it('(i5) SALES คนละสาขา → 403', async () => {
    const { service } = build();
    await expect(service.preview('p1', 'LOST', SALES_B2)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('StockAdjustmentsService.pendingCount / findAll scope', () => {
  it('OWNER นับทุกสาขา · BM นับเฉพาะสาขาตัวเอง', async () => {
    const { service, prisma } = build();
    prisma.stockAdjustment.count.mockResolvedValue(3);
    await service.pendingCount(OWNER);
    expect(prisma.stockAdjustment.count.mock.calls[0][0].where).toEqual({ status: 'PENDING_APPROVAL', deletedAt: null });
    await service.pendingCount({ id: 'bm', role: 'BRANCH_MANAGER', branchId: 'branch-1' });
    expect(prisma.stockAdjustment.count.mock.calls[1][0].where).toEqual({
      status: 'PENDING_APPROVAL',
      deletedAt: null,
      branchId: 'branch-1',
    });
  });

  it('SALES findAll ถูกบีบเป็นสาขาตัวเอง · mine → เฉพาะใบตัวเอง', async () => {
    const { service, prisma } = build();
    await service.findAll({ status: 'PENDING_APPROVAL', mine: true }, SALES_B1);
    const where = prisma.stockAdjustment.findMany.mock.calls[0][0].where;
    expect(where).toEqual(expect.objectContaining({ branchId: 'branch-1', adjustedById: 'sales-1', status: 'PENDING_APPROVAL' }));
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// Task 6 — เจ้าของอนุมัติ / ไม่อนุมัติ
// ────────────────────────────────────────────────────────────────────────────────
describe('StockAdjustmentsService.approve', () => {
  const pendingRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'adj-1',
    requestNumber: 'SA-20261005-0001',
    reason: 'LOST',
    status: 'PENDING_APPROVAL',
    previousStatus: 'IN_STOCK',
    productId: 'p1',
    branchId: 'branch-1',
    adjustedById: 'sales-1',
    photos: [],
    deletedAt: null,
    ...overrides,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const booked = (prisma: any) => {
    prisma.goodsReceivingItem.findFirst.mockResolvedValue({
      receivedCost: new Prisma.Decimal('12000.00'),
      journalEntryId: 'je-gr',
      receiving: { grNumber: 'GR-20261001-001' },
    });
    prisma.journalEntry.findUnique.mockResolvedValue({ entryNumber: 'JE-202610-00012' });
  };

  it('(h) actor ไม่ใช่ OWNER → 403 ไม่แตะอะไร', async () => {
    const { service, prisma, template } = build(baseProduct({ status: 'ADJUSTMENT_PENDING' }));
    prisma.stockAdjustment.findUnique.mockResolvedValue(pendingRow());
    await expect(service.approve('adj-1', { id: 'bm', role: 'BRANCH_MANAGER', branchId: 'branch-1' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(template.execute).not.toHaveBeenCalled();
    expect(prisma.stockAdjustment.update).not.toHaveBeenCalled();
  });

  it('(a) LOST + เครื่องลงบัญชีแล้ว → JE Dr S53-1102/Cr S11-2001 ที่ต้นทุน · เครื่อง LOST+ลบ · ใบ APPROVED ผูก JE', async () => {
    const { service, prisma, template, companies, audit } = build(baseProduct({ status: 'ADJUSTMENT_PENDING' }));
    booked(prisma);
    prisma.stockAdjustment.findUnique.mockResolvedValue(pendingRow());
    template.execute.mockResolvedValue({ journalEntryId: 'je-wo', entryNo: 'JE-202610-00020' });

    const result = await service.approve('adj-1', OWNER);

    expect(companies.getShopCompanyId).toHaveBeenCalled();
    expect(template.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'shop-stock-writeoff:adj-1',
        adjustmentId: 'adj-1',
        requestNumber: 'SA-20261005-0001',
        productId: 'p1',
        reason: 'LOST',
        inventoryAccountCode: 'S11-2001',
        branchId: 'branch-1',
      }),
      prisma,
    );
    expect(template.execute.mock.calls[0][0].amount.toFixed(2)).toBe('12000.00');
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ status: 'LOST', wasPreviouslyDamaged: true, deletedAt: expect.any(Date) }),
      }),
    );
    const upd = prisma.stockAdjustment.update.mock.calls[0][0];
    expect(upd.data).toEqual(
      expect.objectContaining({
        status: 'APPROVED',
        approvedById: 'owner-1',
        journalEntryId: 'je-wo',
        inventoryBooked: true,
        bookedSource: 'GOODS_RECEIVING',
        inventoryAccountCode: 'S11-2001',
      }),
    );
    expect(upd.data.costAmount.toFixed(2)).toBe('12000.00');
    expect(prisma.todo.updateMany).toHaveBeenCalled(); // ปิด Todo เจ้าของ
    expect(prisma.todo.create).not.toHaveBeenCalled(); // ไม่ต้องแจ้งบัญชี
    expect(result.journalEntryNo).toBe('JE-202610-00020');
    expect(result.inventoryBooked).toBe(true);
    expect(result.productStatus).toBe('LOST');
    expect(result.accountingNotified).toBe(false);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'STOCK_ADJUSTMENT_APPROVED', userId: 'owner-1' }));
  });

  it('(b) LOST แต่เครื่องไม่เคยลงบัญชี → ไม่ลง JE · Todo แจ้งฝ่ายบัญชี tag stock-adjustment-unbooked · accountingNotified', async () => {
    const { service, prisma, template } = build(baseProduct({ status: 'ADJUSTMENT_PENDING' }));
    prisma.stockAdjustment.findUnique.mockResolvedValue(pendingRow());
    const result = await service.approve('adj-1', OWNER);
    expect(template.execute).not.toHaveBeenCalled();
    expect(prisma.todo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priority: 'MEDIUM',
          tags: ['stock-adjustment-unbooked', 'sa:SA-20261005-0001'],
          createdById: 'owner-1',
        }),
      }),
    );
    const upd = prisma.stockAdjustment.update.mock.calls[0][0];
    expect(upd.data).toEqual(expect.objectContaining({ status: 'APPROVED', inventoryBooked: false, journalEntryId: null }));
    expect(result.accountingNotified).toBe(true);
    expect(result.journalEntryNo).toBeNull();
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'LOST', deletedAt: expect.any(Date) }) }),
    );
  });

  it('(c) DAMAGED → ไม่ลง JE · เครื่อง DAMAGED คงในสต๊อก (ไม่ลบ) · ไม่มี Todo บัญชี', async () => {
    const { service, prisma, template } = build(baseProduct({ status: 'ADJUSTMENT_PENDING' }));
    booked(prisma);
    prisma.stockAdjustment.findUnique.mockResolvedValue(pendingRow({ reason: 'DAMAGED', photos: ['stock-adjustments/x.jpg'] }));
    const result = await service.approve('adj-1', OWNER);
    expect(template.execute).not.toHaveBeenCalled();
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { status: 'DAMAGED', wasPreviouslyDamaged: true },
    });
    expect(prisma.todo.create).not.toHaveBeenCalled();
    const upd = prisma.stockAdjustment.update.mock.calls[0][0];
    expect(upd.data).toEqual(expect.objectContaining({ status: 'APPROVED', inventoryBooked: null, costAmount: null }));
    expect(result.productStatus).toBe('DAMAGED');
  });

  it('(d) เครื่องไม่ได้อยู่ ADJUSTMENT_PENDING ตอนอนุมัติ → 409 ไม่ลง JE', async () => {
    const { service, prisma, template } = build(baseProduct({ status: 'IN_STOCK' }));
    booked(prisma);
    prisma.stockAdjustment.findUnique.mockResolvedValue(pendingRow());
    await expect(service.approve('adj-1', OWNER)).rejects.toBeInstanceOf(ConflictException);
    expect(template.execute).not.toHaveBeenCalled();
    expect(prisma.stockAdjustment.update).not.toHaveBeenCalled();
  });

  it('(e) FOUND บนเครื่อง LOST ที่มีใบตัดเดิมมี JE → กลับรายการ · เครื่อง IN_STOCK · bookIfPending · ชี้ reversesAdjustmentId', async () => {
    const { service, prisma, template } = build(baseProduct({ status: 'LOST', deletedAt: new Date('2026-10-01') }));
    prisma.stockAdjustment.findUnique.mockResolvedValue(pendingRow({ reason: 'FOUND', previousStatus: 'LOST' }));
    // findFirst #1 = ใบตัดเดิม · findFirst #2 = ยังไม่มีใบ FOUND ที่กลับมัน
    prisma.stockAdjustment.findFirst
      .mockResolvedValueOnce({ id: 'adj-0', requestNumber: 'SA-20261001-0003', journalEntryId: 'je-wo', reason: 'LOST' })
      .mockResolvedValueOnce(null);
    template.reverse.mockResolvedValue({ journalEntryId: 'je-rev', entryNo: 'JE-202610-00021' });

    const result = await service.approve('adj-1', OWNER);

    expect(template.reverse).toHaveBeenCalledWith(
      expect.objectContaining({
        journalEntryId: 'je-wo',
        idempotencyKey: 'shop-stock-writeoff-reversal:adj-1',
        foundAdjustmentId: 'adj-1',
      }),
      prisma,
    );
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'IN_STOCK', deletedAt: null, stockInDate: expect.any(Date) }),
      }),
    );
    expect(bookIfPending).toHaveBeenCalledWith(prisma, 'p1');
    const upd = prisma.stockAdjustment.update.mock.calls[0][0];
    expect(upd.data).toEqual(
      expect.objectContaining({ status: 'APPROVED', journalEntryId: 'je-rev', reversesAdjustmentId: 'adj-0' }),
    );
    expect(result.journalEntryNo).toBe('JE-202610-00021');
    expect(result.productStatus).toBe('IN_STOCK');
  });

  it('(f) FOUND แต่ใบตัดเดิมถูกกลับไปแล้ว → ไม่ reverse · เครื่องกลับสถานะอย่างเดียว', async () => {
    const { service, prisma, template } = build(baseProduct({ status: 'WRITTEN_OFF', deletedAt: new Date('2026-10-01') }));
    prisma.stockAdjustment.findUnique.mockResolvedValue(pendingRow({ reason: 'FOUND', previousStatus: 'WRITTEN_OFF' }));
    prisma.stockAdjustment.findFirst
      .mockResolvedValueOnce({ id: 'adj-0', requestNumber: 'SA-20261001-0003', journalEntryId: 'je-wo', reason: 'WRITE_OFF' })
      .mockResolvedValueOnce({ id: 'adj-found-old' });
    await service.approve('adj-1', OWNER);
    expect(template.reverse).not.toHaveBeenCalled();
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'IN_STOCK', deletedAt: null, restoredFromTerminalAt: expect.any(Date) }),
      }),
    );
    const upd = prisma.stockAdjustment.update.mock.calls[0][0];
    expect(upd.data.journalEntryId).toBeNull();
  });

  it('(f2) FOUND กู้แถว REFURBISHED ที่ถูกลบ → คงสถานะเดิม ไม่ stockInDate ไม่ bookIfPending', async () => {
    const { service, prisma } = build(baseProduct({ status: 'REFURBISHED', deletedAt: new Date('2026-10-01') }));
    prisma.stockAdjustment.findUnique.mockResolvedValue(pendingRow({ reason: 'FOUND', previousStatus: 'REFURBISHED' }));
    const result = await service.approve('adj-1', OWNER);
    const data = prisma.product.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeNull();
    expect(data.status).toBeUndefined();
    expect(data.stockInDate).toBeUndefined();
    expect(bookIfPending).not.toHaveBeenCalled();
    expect(result.productStatus).toBe('REFURBISHED');
  });

  it('(f3) FOUND กู้แถวแล้ว IMEI ชนเครื่องใหม่ (P2002) → 409 ภาษาไทย', async () => {
    const { service, prisma } = build(baseProduct({ status: 'LOST', deletedAt: new Date('2026-10-01') }));
    prisma.stockAdjustment.findUnique.mockResolvedValue(pendingRow({ reason: 'FOUND', previousStatus: 'LOST' }));
    prisma.product.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    await expect(service.approve('adj-1', OWNER)).rejects.toThrow(/IMEI/);
  });

  it('(i) LOST booked แต่ costPrice 0 → ไม่ลง JE · APPROVED · ไม่มี Todo บัญชี', async () => {
    const { service, prisma, template } = build(baseProduct({ status: 'ADJUSTMENT_PENDING', costPrice: new Prisma.Decimal(0) }));
    booked(prisma);
    prisma.stockAdjustment.findUnique.mockResolvedValue(pendingRow());
    const result = await service.approve('adj-1', OWNER);
    expect(template.execute).not.toHaveBeenCalled();
    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect(result.accountingNotified).toBe(false);
    expect(prisma.stockAdjustment.update.mock.calls[0][0].data.status).toBe('APPROVED');
  });

  it('(j) ใบที่ไม่ใช่ PENDING → 409', async () => {
    const { service, prisma } = build(baseProduct({ status: 'IN_STOCK' }));
    prisma.stockAdjustment.findUnique.mockResolvedValue(pendingRow({ status: 'REJECTED' }));
    await expect(service.approve('adj-1', OWNER)).rejects.toBeInstanceOf(ConflictException);
  });

  it('(k) CORRECTION → APPROVED ไม่แตะเครื่อง ไม่ลง JE', async () => {
    const { service, prisma, template } = build();
    prisma.stockAdjustment.findUnique.mockResolvedValue(pendingRow({ reason: 'CORRECTION' }));
    const result = await service.approve('adj-1', OWNER);
    expect(template.execute).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(result.productStatus).toBe('IN_STOCK');
  });
});

describe('StockAdjustmentsService.reject', () => {
  it('(g) reject → เครื่องกลับ previousStatus PHOTO_PENDING (ไม่ใช่ IN_STOCK) · REJECTED + เหตุผล · Todo DONE', async () => {
    const { service, prisma, audit } = build(baseProduct({ status: 'ADJUSTMENT_PENDING' }));
    prisma.stockAdjustment.findUnique.mockResolvedValue({
      id: 'adj-1',
      requestNumber: 'SA-20261005-0001',
      reason: 'WRITE_OFF',
      status: 'PENDING_APPROVAL',
      previousStatus: 'PHOTO_PENDING',
      productId: 'p1',
      adjustedById: 'sales-1',
      deletedAt: null,
    });
    await service.reject('adj-1', { reason: 'เครื่องยังอยู่ ให้ถ่ายรูปต่อ' }, OWNER);
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'ADJUSTMENT_PENDING' },
      data: { status: 'PHOTO_PENDING' },
    });
    expect(prisma.stockAdjustment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REJECTED', rejectedById: 'owner-1', rejectedReason: 'เครื่องยังอยู่ ให้ถ่ายรูปต่อ' }),
      }),
    );
    expect(prisma.todo.updateMany).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'STOCK_ADJUSTMENT_REJECTED' }));
  });

  it('(g2) actor ไม่ใช่ OWNER → 403', async () => {
    const { service, prisma } = build();
    prisma.stockAdjustment.findUnique.mockResolvedValue({ id: 'adj-1', requestNumber: 'SA-1', reason: 'LOST', status: 'PENDING_APPROVAL', previousStatus: 'IN_STOCK', productId: 'p1', adjustedById: 'sales-1', deletedAt: null });
    await expect(service.reject('adj-1', { reason: 'ไม่อนุมัติเพราะยังไม่ชัด' }, SALES_B1)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('StockAdjustmentsService.findAll/findOne — เติมเลขที่รายการบัญชี', () => {
  it('แถวที่มี journalEntryId ได้ journalEntryNo จาก query เดียว · แถวที่ไม่มี = null', async () => {
    const { service, prisma } = build();
    prisma.stockAdjustment.findMany.mockResolvedValue([
      { id: 'a', journalEntryId: 'je-1', branchId: 'branch-1' },
      { id: 'b', journalEntryId: null, branchId: 'branch-1' },
    ]);
    prisma.stockAdjustment.count.mockResolvedValue(2);
    prisma.journalEntry.findMany.mockResolvedValue([{ id: 'je-1', entryNumber: 'JE-202610-00020' }]);
    const res = await service.findAll({}, OWNER);
    expect(res.data.map((r: { journalEntryNo: string | null }) => r.journalEntryNo)).toEqual(['JE-202610-00020', null]);
    expect(prisma.journalEntry.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.journalEntry.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['je-1'] } });
  });

  it('findOne คืน journalEntryNo + photoUrls (ข้าม data: URI ยุคเก่า) + booked เฉพาะใบ PENDING ที่ลงบัญชีได้', async () => {
    const { service, prisma, storage } = build();
    prisma.stockAdjustment.findUnique.mockResolvedValue({
      id: 'a', journalEntryId: 'je-1', branchId: 'branch-1', status: 'APPROVED', reason: 'LOST', productId: 'p1',
      photos: ['stock-adjustments/x.jpg', 'data:image/png;base64,xx'], deletedAt: null,
    });
    prisma.journalEntry.findMany.mockResolvedValue([{ id: 'je-1', entryNumber: 'JE-202610-00020' }]);
    const res = await service.findOne('a', OWNER);
    expect(res.journalEntryNo).toBe('JE-202610-00020');
    expect(res.photoUrls).toEqual(['https://signed/stock-adjustments/x.jpg']);
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledTimes(1);
    expect(res.booked).toBeNull();
  });
});
