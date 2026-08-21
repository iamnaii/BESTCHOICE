import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ProductsService.transferOwnership', () => {
  let service: ProductsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  it('transfers ownership when the target company differs', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', ownedByCompanyId: 'shop-id' });
    prisma.product.update.mockResolvedValue({ id: 'p-1', ownedByCompanyId: 'finance-id' });

    const result = await service.transferOwnership('p-1', 'finance-id');

    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { id: 'p-1', deletedAt: null },
      select: { id: true, ownedByCompanyId: true },
    });
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { ownedByCompanyId: 'finance-id' },
      select: { id: true, ownedByCompanyId: true },
    });
    expect(result).toEqual({ id: 'p-1', ownedByCompanyId: 'finance-id' });
  });

  it('is a no-op when ownership is already at the target', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', ownedByCompanyId: 'finance-id' });

    await service.transferOwnership('p-1', 'finance-id');

    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('supports releasing ownership to null (customer owns after payoff)', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', ownedByCompanyId: 'finance-id' });
    prisma.product.update.mockResolvedValue({ id: 'p-1', ownedByCompanyId: null });

    await service.transferOwnership('p-1', null);

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { ownedByCompanyId: null },
      select: { id: true, ownedByCompanyId: true },
    });
  });

  it('refuses to transfer a soft-deleted (or missing) product', async () => {
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(service.transferOwnership('p-deleted', 'finance-id')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('uses the passed tx client when provided instead of the injected Prisma', async () => {
    const tx = {
      product: {
        findFirst: jest.fn().mockResolvedValue({ id: 'p-1', ownedByCompanyId: null }),
        update: jest.fn().mockResolvedValue({ id: 'p-1', ownedByCompanyId: 'finance-id' }),
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.transferOwnership('p-1', 'finance-id', tx as any);

    expect(tx.product.findFirst).toHaveBeenCalled();
    expect(tx.product.update).toHaveBeenCalled();
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
  });
});

describe('ProductsService.findAll — filters สำหรับการ์ด "เครื่องอื่นรุ่นเดียวกัน" (B1)', () => {
  let service: ProductsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ProductsService>(ProductsService);
  });

  const whereOf = () => prisma.product.findMany.mock.calls[0][0].where;

  it('กรอง model + storage แบบ exact', async () => {
    await service.findAll({ model: 'iPhone 13', storage: '128GB' });
    expect(whereOf()).toMatchObject({ deletedAt: null, model: 'iPhone 13', storage: '128GB' });
  });

  it('status เดี่ยว = ค่าเดิม (ไม่ใช่ { in: [...] })', async () => {
    await service.findAll({ status: 'IN_STOCK' });
    expect(whereOf().status).toBe('IN_STOCK');
  });

  it('status เป็น array → { in: [...] }', async () => {
    await service.findAll({ status: ['IN_STOCK', 'RESERVED'] });
    expect(whereOf().status).toEqual({ in: ['IN_STOCK', 'RESERVED'] });
  });

  it('status เป็น comma string → { in: [...] } (กัน query serializer ต่างกัน)', async () => {
    await service.findAll({ status: 'IN_STOCK,RESERVED' });
    expect(whereOf().status).toEqual({ in: ['IN_STOCK', 'RESERVED'] });
  });

  it('ค่าว่างถูกทิ้ง — ไม่โผล่ใน where', async () => {
    await service.findAll({ model: '', storage: '', status: '' });
    const where = whereOf();
    expect(where).not.toHaveProperty('model');
    expect(where).not.toHaveProperty('storage');
    expect(where).not.toHaveProperty('status');
  });
});

describe('ProductsService.remove — guard กันลบเครื่องที่ยังถูกถือครอง (Phase 5 T1)', () => {
  let service: ProductsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const productRow = (status: string) => ({
    id: 'p-1',
    name: 'iPhone 13 128GB',
    imeiSerial: '350000000000001',
    status,
    deletedAt: null,
  });

  beforeEach(async () => {
    prisma = {
      product: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'p-1', deletedAt: new Date() }),
      },
      contract: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      productReservation: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      onlineOrder: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ProductsService>(ProductsService);
  });

  it('ลบไม่ได้เมื่อสถานะ SOLD_INSTALLMENT (อยู่ในสัญญา) — บอกทางออกให้ยกเลิกสัญญา/ยึดเครื่อง', async () => {
    prisma.product.findUnique.mockResolvedValue(productRow('SOLD_INSTALLMENT'));

    await expect(service.remove('p-1')).rejects.toThrow(BadRequestException);
    await expect(service.remove('p-1')).rejects.toThrow(/ยกเลิกสัญญา/);
    await expect(service.remove('p-1')).rejects.toThrow(/ยึดเครื่อง/);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('ลบไม่ได้เมื่อสถานะ RESERVED (ติดจอง) — บอกให้ยกเลิกจองก่อน', async () => {
    prisma.product.findUnique.mockResolvedValue(productRow('RESERVED'));

    await expect(service.remove('p-1')).rejects.toThrow(BadRequestException);
    await expect(service.remove('p-1')).rejects.toThrow(/ยกเลิกจอง/);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('ลบไม่ได้เมื่อสถานะ REPOSSESSED (เครื่องยึดที่ยังไม่ขายต่อ) — บอกให้ขายต่อ/ตีราคาใหม่ก่อน', async () => {
    prisma.product.findUnique.mockResolvedValue(productRow('REPOSSESSED'));

    await expect(service.remove('p-1')).rejects.toThrow(BadRequestException);
    await expect(service.remove('p-1')).rejects.toThrow(/ขายต่อ/);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('ลบไม่ได้เมื่อมีสัญญาที่ยังไม่จบอ้างอิงอยู่ แม้สถานะจะเป็น IN_STOCK (สถานะเพี้ยน)', async () => {
    prisma.product.findUnique.mockResolvedValue(productRow('IN_STOCK'));
    prisma.contract.findFirst.mockResolvedValue({
      contractNumber: 'CT-20260101-0001',
      status: 'ACTIVE',
    });

    await expect(service.remove('p-1')).rejects.toThrow(BadRequestException);
    await expect(service.remove('p-1')).rejects.toThrow(/CT-20260101-0001/);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('ค้นสัญญาค้างด้วย exclude-list ของสถานะที่จบแล้ว (notIn) — สถานะใหม่ในอนาคตต้องไม่หลุด guard', async () => {
    prisma.product.findUnique.mockResolvedValue(productRow('IN_STOCK'));

    await service.remove('p-1');

    const where = prisma.contract.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ productId: 'p-1', deletedAt: null });
    expect(where.status.notIn).toEqual(
      expect.arrayContaining([
        'CANCELED',
        'COMPLETED',
        'EARLY_PAYOFF',
        'CLOSED_BAD_DEBT',
        'EXCHANGED',
        'DEFECT_EXCHANGED',
      ]),
    );
    // สถานะที่ยังเดินอยู่ห้ามอยู่ใน exclude list
    for (const live of ['DRAFT', 'ACTIVE', 'OVERDUE', 'DEFAULT', 'TERMINATED']) {
      expect(where.status.notIn).not.toContain(live);
    }
  });

  it('ลบได้เมื่อ IN_STOCK และไม่มีสัญญาค้าง', async () => {
    prisma.product.findUnique.mockResolvedValue(productRow('IN_STOCK'));

    await service.remove('p-1');

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('ลบได้เมื่อ SOLD_CASH (ขายจบแล้ว — IMEI กลับมาใหม่ได้ตามเจตนา T5-C12)', async () => {
    prisma.product.findUnique.mockResolvedValue(productRow('SOLD_CASH'));

    await service.remove('p-1');

    expect(prisma.product.update).toHaveBeenCalled();
  });

  it('ลบได้เมื่อ SOLD_RESELL (ขายต่อจบแล้ว)', async () => {
    prisma.product.findUnique.mockResolvedValue(productRow('SOLD_RESELL'));

    await service.remove('p-1');

    expect(prisma.product.update).toHaveBeenCalled();
  });
});

describe('ProductsService.remove — จอง/ออเดอร์ออนไลน์ (review fix I2: flow นี้ไม่แตะ product.status)', () => {
  let service: ProductsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'p-1', name: 'iPhone 13', status: 'IN_STOCK', deletedAt: null }),
        update: jest.fn().mockResolvedValue({ id: 'p-1' }),
      },
      contract: { findFirst: jest.fn().mockResolvedValue(null) },
      productReservation: { findFirst: jest.fn().mockResolvedValue(null) },
      onlineOrder: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ProductsService>(ProductsService);
  });

  it('ลบไม่ได้เมื่อมีการจองบนเว็บที่ยัง ACTIVE (product ยัง IN_STOCK และไม่มีสัญญา)', async () => {
    prisma.productReservation.findFirst.mockResolvedValue({
      expiresAt: new Date('2026-09-01T00:00:00Z'),
    });

    await expect(service.remove('p-1')).rejects.toThrow(BadRequestException);
    await expect(service.remove('p-1')).rejects.toThrow(/จอง/);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('การจองที่หมดอายุแล้วไม่บล็อก — query กรอง status ACTIVE + expiresAt > now', async () => {
    await service.remove('p-1');

    const where = prisma.productReservation.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ productId: 'p-1', status: 'ACTIVE' });
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
    expect(prisma.product.update).toHaveBeenCalled();
  });

  it('ลบไม่ได้เมื่อมีออเดอร์ออนไลน์ที่ fulfilment ยังเปิด (เงินเข้าแล้วแต่ของยังไม่ถึงมือ)', async () => {
    prisma.onlineOrder.findFirst.mockResolvedValue({
      orderNumber: 'OO-20260101-0001',
      status: 'PAID',
    });

    await expect(service.remove('p-1')).rejects.toThrow(BadRequestException);
    await expect(service.remove('p-1')).rejects.toThrow(/OO-20260101-0001/);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('ออเดอร์ใช้ exclude-list (notIn) — ยังไม่จ่าย/จบแล้ว ไม่บล็อก, PAID/PACKING/SHIPPED/รอตรวจสลิป บล็อก', async () => {
    await service.remove('p-1');

    const where = prisma.onlineOrder.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ productId: 'p-1', deletedAt: null });
    expect(where.status.notIn).toEqual(
      expect.arrayContaining([
        'DRAFT',
        'PENDING_PAYMENT',
        'DELIVERED',
        'COMPLETED',
        'CANCELLED',
        'REFUNDED',
        'PAYMENT_RECEIVED_UNFULFILLABLE',
      ]),
    );
    for (const open of ['PAID', 'PACKING', 'SHIPPED', 'PENDING_BANK_REVIEW']) {
      expect(where.status.notIn).not.toContain(open);
    }
  });
});

describe('ProductsService.update — กันแก้ IMEI/Serial บนเครื่องที่ยังถูกถือครอง (review fix I1)', () => {
  let service: ProductsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const setProduct = (status: string) =>
    prisma.product.findUnique.mockResolvedValue({
      id: 'p-1',
      name: 'iPhone 13',
      status,
      imeiSerial: '350000000000001',
      serialNumber: 'SN-001',
      brand: 'Apple',
      model: 'iPhone 13',
      storage: '128GB',
      category: 'PHONE_NEW',
      deletedAt: null,
    });

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn() },
      contract: { findFirst: jest.fn().mockResolvedValue(null) },
      productReservation: { findFirst: jest.fn().mockResolvedValue(null) },
      onlineOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      // ไม่เรียก callback — เทสนี้สนใจแค่ "ผ่านด่านแล้วไปเขียนจริงหรือไม่"
      $transaction: jest.fn().mockResolvedValue({ id: 'p-1' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ProductsService>(ProductsService);
  });

  it('แก้ IMEI บนเครื่อง SOLD_INSTALLMENT → reject (ปลด IMEI ให้ว่างโดยไม่ต้องลบ)', async () => {
    setProduct('SOLD_INSTALLMENT');

    await expect(service.update('p-1', { imeiSerial: '350000000000999' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.update('p-1', { imeiSerial: '350000000000999' })).rejects.toThrow(/IMEI/);
    await expect(service.update('p-1', { imeiSerial: '350000000000999' })).rejects.toThrow(
      /ยกเลิกสัญญา/,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('แก้ serialNumber บนเครื่อง RESERVED → reject (ฟิลด์ระบุตัวเครื่องเหมือนกัน)', async () => {
    setProduct('RESERVED');

    await expect(service.update('p-1', { serialNumber: 'SN-999' })).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ล้าง IMEI (ส่งค่าว่าง) บนเครื่องที่ถูกถือครอง → reject เช่นกัน', async () => {
    setProduct('SOLD_INSTALLMENT');

    await expect(service.update('p-1', { imeiSerial: '' })).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('แก้ฟิลด์อื่น (ชื่อ/สี) บนเครื่องที่ถูกถือครอง → ยังทำได้', async () => {
    setProduct('SOLD_INSTALLMENT');

    await service.update('p-1', { name: 'iPhone 13 แก้ชื่อ', color: 'Midnight' });

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('ส่ง IMEI ค่าเดิม (no-op) บนเครื่องที่ถูกถือครอง → ผ่าน ไม่ยิงด่าน', async () => {
    setProduct('SOLD_INSTALLMENT');

    await service.update('p-1', { imeiSerial: '350000000000001' });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.contract.findFirst).not.toHaveBeenCalled();
  });

  it('แก้ IMEI บนเครื่อง IN_STOCK ที่ว่างจริง → ทำได้', async () => {
    setProduct('IN_STOCK');

    await service.update('p-1', { imeiSerial: '350000000000999' });

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('แก้ IMEI บนเครื่อง IN_STOCK ที่ยังมีสัญญาเดินอยู่ → reject (สถานะเพี้ยน)', async () => {
    setProduct('IN_STOCK');
    prisma.contract.findFirst.mockResolvedValue({ contractNumber: 'CT-1', status: 'ACTIVE' });

    await expect(service.update('p-1', { imeiSerial: '350000000000999' })).rejects.toThrow(/CT-1/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('แก้ IMEI บนเครื่อง IN_STOCK ที่ถูกจองบนเว็บ → reject', async () => {
    setProduct('IN_STOCK');
    prisma.productReservation.findFirst.mockResolvedValue({ expiresAt: new Date('2026-09-01') });

    await expect(service.update('p-1', { imeiSerial: '350000000000999' })).rejects.toThrow(/จอง/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // Phase 5 Task 3 — ปิดทางแก้มือ REFURBISHED → IN_STOCK ผ่าน PATCH (ต้องใช้ปุ่ม)
  it('PATCH เปลี่ยน REFURBISHED → IN_STOCK ตรง ๆ ไม่ได้อีกต่อไป — บอกให้ใช้ปุ่ม', async () => {
    setProduct('REFURBISHED');

    await expect(service.update('p-1', { status: 'IN_STOCK' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.update('p-1', { status: 'IN_STOCK' })).rejects.toThrow(
      /นำเข้าคลังพร้อมขาย/,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('PATCH REFURBISHED → DAMAGED ยังทำได้ (ไม่ล็อกทั้งสถานะ)', async () => {
    setProduct('REFURBISHED');

    await expect(service.update('p-1', { status: 'DAMAGED' })).resolves.toBeDefined();
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

/**
 * Phase 5 Task 3 — ปุ่ม "นำเข้าคลังพร้อมขาย" (REFURBISHED → IN_STOCK)
 *
 * เครื่องมือสองที่รับคืน (ยึดเครื่อง markReadyForSale / เปลี่ยนเครื่อง A.4) จบที่สถานะ
 * REFURBISHED แต่ POS ขายได้เฉพาะ IN_STOCK (`sale-writer.service.ts`) ⇒ เดิมต้องแก้สถานะ
 * มือผ่าน PATCH ซึ่งไม่ทิ้งร่องรอยว่าใครเป็นคนตัดสินว่าเครื่องพร้อมขาย
 * คำตัดสินเจ้าของ 2026-08-21: หน้าร้านกดเอง (มีจังหวะตรวจสภาพ/ตั้งราคาก่อนขาย)
 */
describe('ProductsService.returnToStock — นำเข้าคลังพร้อมขาย (Phase 5 T3)', () => {
  let service: ProductsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  const productRow = (over: Record<string, unknown> = {}) => ({
    id: 'p-1',
    name: 'iPhone 13 128GB',
    imeiSerial: '350000000000001',
    status: 'REFURBISHED',
    // fix round 1 [Important 2]: เครื่องที่คืนมาจาก swap/ยึด **ยังถือราคาเครื่องใหม่**
    // (ไม่มี flow ไหนล้างคอลัมน์ราคา) — ฟิกซ์เจอร์จึงมีราคาเก่าติดมาเสมอ
    cashPrice: '15900',
    installmentPrice: '19900',
    prices: [],
    deletedAt: null,
    ...over,
  });

  // fix round 2 [Important 2]: ฟิกซ์เจอร์มีราคาเก่าทั้งสองช่อง ⇒ ต้องยืนยันครบทั้งคู่
  const dto = { cashPrice: 9900, installmentPrice: 11900, note: 'ตรวจสภาพแล้ว' };

  beforeEach(async () => {
    tx = {
      product: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(productRow({ status: 'IN_STOCK' })),
      },
      productPrice: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'pr-new' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      product: { findUnique: jest.fn().mockResolvedValue(productRow()) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ProductsService>(ProductsService);
  });

  it('เขียนราคาที่ยืนยัน + สถานะ + stockInDate ใน tx เดียว (ราคาเก่าถูกทับ ไม่ใช่แค่ผ่านด่าน)', async () => {
    await service.returnToStock('p-1', 'user-1', { cashPrice: 9900, installmentPrice: 11900 });

    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-1', status: 'REFURBISHED', deletedAt: null },
      data: expect.objectContaining({ status: 'IN_STOCK' }),
    });
    const data = tx.product.updateMany.mock.calls[0][0].data;
    expect(data.cashPrice.toString()).toBe('9900');
    expect(data.installmentPrice.toString()).toBe('11900');
    expect(data.stockInDate).toBeInstanceOf(Date);
    // ราคาที่มนุษย์ยืนยัน = ไม่ใช่ราคาที่เติมอัตโนมัติอีกต่อไป
    expect(data.priceAutofilledAt).toBeNull();
    // write-through ไปแถว prices[] เหมือนเส้นทางแก้ราคาปกติ
    expect(tx.productPrice.findMany).toHaveBeenCalled();
  });

  it('AuditLog PRODUCT_RETURNED_TO_STOCK บันทึกราคาเก่า→ใหม่ (ตรวจย้อนได้ว่าใครตั้งราคาเท่าไร)', async () => {
    await service.returnToStock('p-1', 'user-1', dto);

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        action: 'PRODUCT_RETURNED_TO_STOCK',
        entity: 'product',
        entityId: 'p-1',
        oldValue: expect.objectContaining({
          status: 'REFURBISHED',
          cashPrice: '15900',
          installmentPrice: '19900',
        }),
        newValue: expect.objectContaining({
          status: 'IN_STOCK',
          cashPrice: '9900',
          note: 'ตรวจสภาพแล้ว',
        }),
      }),
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('note เป็น optional — ไม่ส่งก็บันทึกได้ (newValue.note = null)', async () => {
    await service.returnToStock('p-1', 'user-1', { cashPrice: 9900, installmentPrice: 11900 });

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        newValue: expect.objectContaining({ status: 'IN_STOCK', note: null }),
      }),
    });
  });

  it('ไม่ส่งราคามาเลย → reject (บังคับให้ราคาผ่านตาคน ไม่ใช่แค่ "มีราคาเก่าค้างอยู่")', async () => {
    await expect(service.returnToStock('p-1', 'user-1', {})).rejects.toThrow(BadRequestException);
    await expect(service.returnToStock('p-1', 'user-1', {})).rejects.toThrow(/ยืนยันราคาขาย/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ส่งราคา 0/ติดลบ → reject เช่นกัน', async () => {
    await expect(service.returnToStock('p-1', 'user-1', { cashPrice: 0 })).rejects.toThrow(
      /ยืนยันราคาขาย/,
    );
    await expect(service.returnToStock('p-1', 'user-1', { installmentPrice: -1 })).rejects.toThrow(
      /ยืนยันราคาขาย/,
    );
  });

  it('เครื่องที่ไม่มีราคาเงินสดเดิม → ยืนยันเฉพาะราคาผ่อนได้ และไม่แตะคอลัมน์เงินสด', async () => {
    prisma.product.findUnique.mockResolvedValue(productRow({ cashPrice: null }));

    await expect(
      service.returnToStock('p-1', 'user-1', { installmentPrice: 11900 }),
    ).resolves.toBeDefined();
    const data = tx.product.updateMany.mock.calls[0][0].data;
    expect(data.installmentPrice.toString()).toBe('11900');
    expect(data.cashPrice).toBeUndefined();
  });

  /**
   * fix round 2 [Important 2] — ยืนยันช่องเดียวแล้วปล่อยอีกช่องว่าง = ราคาเครื่องใหม่ค้าง
   * ในคอลัมน์นั้น และ `syncPriceRowsFromColumns` ก็ข้ามฝั่งนั้น (`keepDefaultId` = null
   * เมื่อมีแถว default เดิมอยู่) ⇒ **แถว default ที่ POS อ่านยังเป็นราคาเครื่องใหม่**
   */
  it('มีราคาเงินสดเก่าอยู่แต่ไม่ส่งมายืนยัน → reject พร้อมระบุยอดที่ค้าง', async () => {
    await expect(
      service.returnToStock('p-1', 'user-1', { installmentPrice: 11900 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.returnToStock('p-1', 'user-1', { installmentPrice: 11900 }),
    ).rejects.toThrow(/ราคาเงินสดเดิม 15900/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ทิศกลับกัน: มีราคาผ่อนเก่าอยู่แต่ยืนยันมาเฉพาะเงินสด → reject เช่นกัน', async () => {
    await expect(service.returnToStock('p-1', 'user-1', { cashPrice: 9900 })).rejects.toThrow(
      /ราคาผ่อนเดิม 19900/,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ส่งราคา 0 มาในช่องที่มีราคาเก่า = ยังไม่นับว่ายืนยัน → reject (ยกเลิกราคาทำที่หน้าแก้ราคา)', async () => {
    await expect(
      service.returnToStock('p-1', 'user-1', { cashPrice: 9900, installmentPrice: 0 }),
    ).rejects.toThrow(/ราคาผ่อนเดิม 19900/);
  });

  it.each(['IN_STOCK', 'SOLD_INSTALLMENT', 'DAMAGED', 'REPOSSESSED'])(
    'สถานะ %s → reject ภาษาไทย (บอกสถานะปัจจุบัน) และไม่แตะสถานะ',
    async (status) => {
      prisma.product.findUnique.mockResolvedValue(productRow({ status }));

      await expect(service.returnToStock('p-1', 'user-1', dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.returnToStock('p-1', 'user-1', dto)).rejects.toThrow(
        new RegExp(status),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('สินค้าที่ถูกลบ → NotFound (ไม่มีทางปลุกเครื่องที่ลบแล้วกลับเข้าสต็อก)', async () => {
    prisma.product.findUnique.mockResolvedValue(productRow({ deletedAt: new Date() }));

    await expect(service.returnToStock('p-1', 'user-1', dto)).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('มีคนกดพร้อมกัน (แถวถูกเปลี่ยนสถานะไปแล้ว) → 409 และไม่มี AuditLog ใบซ้ำ', async () => {
    tx.product.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.returnToStock('p-1', 'user-1', dto)).rejects.toThrow(ConflictException);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

/**
 * Fix round 1 [Important 1] — ปิด two-hop `REFURBISHED → QC_PENDING → IN_STOCK`
 *
 * deny-list ราย transition ปิดได้แค่คู่ตรง ๆ; ผู้ใช้ที่เพิ่งโดนด่านราคาบล็อกสามารถ
 * "ฟอกสถานะ" ผ่านสถานะกลางแล้วเข้า IN_STOCK ได้ในสองคลิก โดยไม่มีเช็คราคา/stockInDate/audit
 * ⇒ ย้ายด่านไปที่ **ปลายทาง**: ทุกการเปลี่ยนสถานะด้วยมือที่ลงเอยที่ IN_STOCK ต้องมีราคาขาย
 * และต้องได้ stockInDate + AuditLog ชุดเดียวกับปุ่ม (ฟอกสถานะแล้วไม่ได้ผลลัพธ์ที่เงียบกว่า)
 */
describe('ProductsService.update — ด่านปลายทาง IN_STOCK (fix round 1)', () => {
  let service: ProductsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  const setProduct = (over: Record<string, unknown>) =>
    prisma.product.findUnique.mockResolvedValue({
      id: 'p-1',
      name: 'iPhone 13',
      status: 'QC_PENDING',
      imeiSerial: '350000000000001',
      serialNumber: 'SN-001',
      cashPrice: null,
      installmentPrice: null,
      prices: [],
      deletedAt: null,
      ...over,
    });

  beforeEach(async () => {
    tx = {
      product: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ id: 'p-1', status: 'IN_STOCK' }),
      },
      productPrice: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'pr-1' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      product: { findUnique: jest.fn() },
      contract: { findFirst: jest.fn().mockResolvedValue(null) },
      productReservation: { findFirst: jest.fn().mockResolvedValue(null) },
      onlineOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ProductsService>(ProductsService);
  });

  it('two-hop: QC_PENDING → IN_STOCK ที่ยังไม่มีราคาขาย → reject (ขาที่สองของการฟอกสถานะ)', async () => {
    setProduct({ status: 'QC_PENDING' });

    await expect(service.update('p-1', { status: 'IN_STOCK' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.update('p-1', { status: 'IN_STOCK' })).rejects.toThrow(/ราคาขาย/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['PHOTO_PENDING', 'INSPECTION', 'DAMAGED', 'PO_RECEIVED'])(
    'สถานะกลางอื่น (%s) → IN_STOCK ที่ยังไม่มีราคา ก็ถูกกันเหมือนกัน',
    async (status) => {
      setProduct({ status });

      await expect(service.update('p-1', { status: 'IN_STOCK' })).rejects.toThrow(/ราคาขาย/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('มีราคาขายอยู่แล้ว → ผ่าน แต่ต้องได้ stockInDate + AuditLog เหมือนกดปุ่ม', async () => {
    setProduct({ status: 'QC_PENDING', cashPrice: '15900' });

    await service.update('p-1', { status: 'IN_STOCK' }, 'user-9');

    const data = tx.product.update.mock.calls[0][0].data;
    expect(data.stockInDate).toBeInstanceOf(Date);
    // minor fix round 2: audit ฝั่ง PATCH ต้องมีราคาเก่า→ใหม่เหมือนฝั่งปุ่ม ไม่งั้นสูตร
    // ตรวจ residual ("เข้าคลังโดยไม่ยืนยันราคา") แยกแยะแถวไม่ได้เลย
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'PRODUCT_RETURNED_TO_STOCK',
        entity: 'product',
        entityId: 'p-1',
        oldValue: expect.objectContaining({ status: 'QC_PENDING', cashPrice: '15900' }),
        newValue: expect.objectContaining({
          status: 'IN_STOCK',
          via: 'PATCH',
          cashPrice: '15900',
        }),
      }),
    });
  });

  it('ราคาที่อยู่ในแถว prices[] ที่ถูกลบไปแล้ว ไม่นับเป็น "มีราคา" (minor fix round 1)', async () => {
    setProduct({
      status: 'QC_PENDING',
      prices: [{ id: 'pr-1', amount: '9900', deletedAt: new Date() }],
    });

    await expect(service.update('p-1', { status: 'IN_STOCK' })).rejects.toThrow(/ราคาขาย/);
  });

  it('แถว prices[] ที่ยังไม่ถูกลบ นับเป็นมีราคา → ผ่าน', async () => {
    setProduct({
      status: 'QC_PENDING',
      prices: [{ id: 'pr-1', amount: '9900', deletedAt: null }],
    });

    await expect(service.update('p-1', { status: 'IN_STOCK' })).resolves.toBeDefined();
  });

  it('ตั้งราคาพร้อมเปลี่ยนสถานะในใบเดียว → ผ่าน (ด่านเช็คราคา "หลังอัปเดต")', async () => {
    setProduct({ status: 'QC_PENDING', cashPrice: null });

    await expect(
      service.update('p-1', { status: 'IN_STOCK', cashPrice: 15900 }, 'user-9'),
    ).resolves.toBeDefined();
  });

  it('ผู้เรียกภายในที่ไม่มีตัวตนผู้ใช้ → ยังได้ stockInDate แต่ข้ามการเขียน audit (ตั้งใจ)', async () => {
    setProduct({ status: 'QC_PENDING', cashPrice: '15900' });

    await service.update('p-1', { status: 'IN_STOCK' });

    expect(tx.product.update.mock.calls[0][0].data.stockInDate).toBeInstanceOf(Date);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('แก้ฟิลด์อื่นบนเครื่องที่ IN_STOCK อยู่แล้ว (ส่ง status เดิม) ไม่โดนด่านนี้', async () => {
    setProduct({ status: 'IN_STOCK', cashPrice: null });

    await expect(
      service.update('p-1', { status: 'IN_STOCK', name: 'ชื่อใหม่' }, 'user-9'),
    ).resolves.toBeDefined();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
