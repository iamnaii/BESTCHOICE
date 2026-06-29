import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PurchaseOrdersService.getSummary', () => {
  it('returns compute-on-read counts incl. overdue (ORDERED & expectedDate < now)', async () => {
    const poCount = jest.fn().mockImplementation(({ where }) => {
      if (where.status === 'DRAFT') return Promise.resolve(2);
      if (where.status === 'APPROVED') return Promise.resolve(3);
      if (where.status === 'ORDERED' && where.expectedDate) return Promise.resolve(1); // overdue
      if (where.status === 'ORDERED') return Promise.resolve(5); // incoming
      if (where.status === 'PARTIALLY_RECEIVED') return Promise.resolve(4);
      if (where.paymentStatus) return Promise.resolve(7); // unpaid
      return Promise.resolve(0);
    });
    const prisma: any = {
      purchaseOrder: { count: poCount },
      product: { count: jest.fn().mockResolvedValue(6) }, // waitingQc
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const service = module.get<PurchaseOrdersService>(PurchaseOrdersService);

    const s = await service.getSummary();
    expect(s).toEqual({
      pendingApproval: 2, toOrder: 3, incoming: 5, overdue: 1,
      receiving: 4, waitingQc: 6, unpaid: 7,
    });
    // overdue query must filter ORDERED + expectedDate < now
    expect(poCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'ORDERED', expectedDate: { lt: expect.any(Date) } }) }),
    );
  });
});
