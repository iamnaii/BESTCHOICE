import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('goodsReceiving — persists structured defectReason on REJECT', () => {
  it('writes defectReason onto the rejected GoodsReceivingItem', async () => {
    const created: any[] = [];
    const tx: any = {
      purchaseOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'po-1', status: 'APPROVED', deletedAt: null, supplierId: 's1',
          items: [{ id: 'poi-1', category: 'PHONE_NEW', brand: 'A', model: 'B' }],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'wh', name: 'คลังกลาง' }) },
      goodsReceiving: { create: jest.fn().mockResolvedValue({ id: 'gr1' }), count: jest.fn().mockResolvedValue(0) },
      goodsReceivingItem: { create: jest.fn().mockImplementation(({ data }) => { created.push(data); return Promise.resolve({ id: 'gri1', ...data }); }) },
      pOItem: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      product: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      productPrice: { create: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const service = module.get<PurchaseOrdersService>(PurchaseOrdersService);

    await service.goodsReceiving('po-1', {
      items: [{ poItemId: 'poi-1', status: 'REJECT', rejectReason: 'จอแตก', defectReason: 'SCREEN' }],
    } as never, 'user-1');

    expect(created[0]).toEqual(expect.objectContaining({ status: 'REJECT', defectReason: 'SCREEN', rejectReason: 'จอแตก' }));
  });
});
