import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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
