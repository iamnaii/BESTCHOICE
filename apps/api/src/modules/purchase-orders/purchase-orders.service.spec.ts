import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * T5-C16: PO goods-receive race condition — now defended on goodsReceiving()
 * (the legacy receive() path was retired in Purchasing v2 B0). goodsReceiving()
 * re-reads POItem rows via findMany inside a Serializable tx and rejects a
 * second batch that would push receivedQty over quantity.
 */
describe('PurchaseOrdersService — T5-C16 goodsReceiving race condition', () => {
  let service: PurchaseOrdersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    const dbState = {
      items: [{ id: 'poi-1', brand: 'Apple', model: 'iPhone 16', quantity: 5, receivedQty: 0, category: 'PHONE_NEW', accessoryType: null, accessoryBrand: null, color: null, storage: null, unitPrice: 30000 }],
    };
    const tx = {
      purchaseOrder: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve({ id: 'po-1', status: 'APPROVED', deletedAt: null, supplierId: 'sup-1', supplier: { id: 'sup-1', name: 'Sup' }, items: dbState.items.map((i) => ({ ...i })) })),
        update: jest.fn().mockResolvedValue({}),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'wh', name: 'คลังกลาง' }) },
      goodsReceiving: { create: jest.fn().mockResolvedValue({ id: 'gr1' }), count: jest.fn().mockResolvedValue(0) },
      goodsReceivingItem: { create: jest.fn().mockResolvedValue({ id: 'gri1' }) },
      product: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: `prod-${Math.random()}`, ...data })),
        findMany: jest.fn().mockResolvedValue([]), // no existing IMEI conflicts
      },
      productPrice: { create: jest.fn() },
      pOItem: {
        findMany: jest.fn().mockImplementation(({ where: { id: { in: ids } } }) =>
          Promise.resolve(dbState.items.filter((i) => ids.includes(i.id)).map((i) => ({ ...i })))),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const item = dbState.items.find((i) => i.id === where.id);
          if (item) item.receivedQty = data.receivedQty;
          return Promise.resolve(item);
        }),
      },
    };
    prisma = { $transaction: jest.fn().mockImplementation(async (fn: any) => (typeof fn === 'function' ? fn(tx) : Promise.all(fn))) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<PurchaseOrdersService>(PurchaseOrdersService);
  });

  const passUnits = (n: number) => ({ items: Array.from({ length: n }, (_, i) => ({ poItemId: 'poi-1', status: 'PASS', imeiSerial: `IMEI-${Math.random()}-${i}` })) });

  it('first batch within ceiling passes and advances receivedQty', async () => {
    const result = await service.goodsReceiving('po-1', passUnits(3) as never, 'user-1');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(result.passed).toBe(3);          // 3 PASS units created
    expect(result.status).toBe('PARTIALLY_RECEIVED'); // 3 of 5 ordered
  });

  it('second batch that would exceed ordered qty is rejected on fresh DB state', async () => {
    await service.goodsReceiving('po-1', passUnits(3) as never, 'user-1');
    await expect(service.goodsReceiving('po-1', passUnits(3) as never, 'user-1')).rejects.toThrow(BadRequestException);
  });
});

describe('goodsReceiving — IMEI duplicate guard', () => {
  it('rejects an IMEI already present in the system', async () => {
    const tx: any = {
      purchaseOrder: { findUnique: jest.fn().mockResolvedValue({ id: 'po-1', status: 'APPROVED', deletedAt: null, supplierId: 's1', items: [{ id: 'poi-1', category: 'PHONE_NEW', quantity: 5, receivedQty: 0, brand: 'A', model: 'B' }] }), update: jest.fn() },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'wh', name: 'คลังกลาง' }) },
      goodsReceiving: { create: jest.fn().mockResolvedValue({ id: 'gr1' }), count: jest.fn().mockResolvedValue(0) },
      goodsReceivingItem: { create: jest.fn() },
      pOItem: { findMany: jest.fn().mockResolvedValue([{ id: 'poi-1', quantity: 5, receivedQty: 0, brand: 'A', model: 'B' }]), update: jest.fn() },
      product: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([{ imeiSerial: 'DUP1', name: 'iPhone', deletedAt: null }]) },
      productPrice: { create: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    const module: TestingModule = await Test.createTestingModule({ providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }] }).compile();
    const service = module.get<PurchaseOrdersService>(PurchaseOrdersService);

    await expect(service.goodsReceiving('po-1', { items: [{ poItemId: 'poi-1', status: 'PASS', imeiSerial: 'DUP1' }] } as never, 'user-1')).rejects.toThrow(/IMEI ซ้ำ/);
  });
});
