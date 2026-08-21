import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
