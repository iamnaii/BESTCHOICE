import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('goodsReceiving — retries on grNumber unique collision (P2002)', () => {
  it('retries the transaction once on P2002 then succeeds', async () => {
    let calls = 0;
    const prisma: any = {
      $transaction: jest.fn().mockImplementation(async (fn: any) => {
        calls += 1;
        if (calls === 1) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }
        return { receivingId: 'r1', grNumber: 'GR-2026-06-002', status: 'FULLY_RECEIVED' };
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const service = module.get<PurchaseOrdersService>(PurchaseOrdersService);

    const result = await service.goodsReceiving('po-1', { items: [] } as never, 'user-1');
    expect(calls).toBe(2);
    expect(result.grNumber).toBe('GR-2026-06-002');
  });
});
