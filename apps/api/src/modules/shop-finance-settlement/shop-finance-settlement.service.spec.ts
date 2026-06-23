import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { ShopFinanceSettlementService } from './shop-finance-settlement.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ShopFinanceReceiptTemplate } from '../journal/cpa-templates/shop-finance-receipt.template';

describe('ShopFinanceSettlementService', () => {
  let service: ShopFinanceSettlementService;
  let prisma: any;
  let template: any;

  beforeEach(async () => {
    prisma = {
      contract: { findMany: jest.fn() },
      journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };
    template = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-1', journalEntryId: 'je-1' }) };
    const mod = await Test.createTestingModule({
      providers: [
        ShopFinanceSettlementService,
        { provide: PrismaService, useValue: prisma },
        { provide: ShopFinanceReceiptTemplate, useValue: template },
      ],
    }).compile();
    service = mod.get(ShopFinanceSettlementService);
  });

  it('posts a ShopFinanceReceipt per contract with financed+commission from the contract', async () => {
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-1', contractNumber: 'CN-1', financedAmount: new Decimal('18000'), storeCommission: new Decimal('1500'), status: 'ACTIVE', deletedAt: null },
    ]);
    await service.settle({ contractIds: ['c-1'] });
    const input = template.execute.mock.calls[0][0];
    expect(input).toMatchObject({ idempotencyKey: 'finance-receipt-c-1', contractId: 'c-1', bankAccountCode: 'S11-1201' });
    expect(input.financedAmount.toString()).toBe('18000');
    expect(input.commission.toString()).toBe('1500');
  });

  it('listPending returns ACTIVE contracts without a shop-finance-receipt JE', async () => {
    prisma.contract.findMany.mockResolvedValue([{ id: 'c-1' }, { id: 'c-2' }]);
    prisma.journalEntry.findMany.mockResolvedValue([{ metadata: { contractId: 'c-1' } }]);
    const pending = await service.listPending();
    expect(pending.map((c: any) => c.id)).toEqual(['c-2']);
  });
});
