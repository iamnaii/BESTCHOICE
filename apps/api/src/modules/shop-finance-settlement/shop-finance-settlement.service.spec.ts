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

  it('does not post a receipt for DRAFT contracts (settle status guard)', async () => {
    // findMany returns [] because the DRAFT contract is filtered out by the status filter
    prisma.contract.findMany.mockResolvedValue([]);
    await service.settle({ contractIds: ['draft-contract-1'] });
    expect(prisma.contract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: expect.objectContaining({ in: expect.arrayContaining(['ACTIVE']) }),
        }),
      }),
    );
    expect(template.execute).not.toHaveBeenCalled();
  });

  it('listPending returns ACTIVE contracts without a shop-finance-receipt JE', async () => {
    prisma.contract.findMany.mockResolvedValue([{ id: 'c-1' }, { id: 'c-2' }]);
    prisma.journalEntry.findMany.mockResolvedValue([{ metadata: { contractId: 'c-1' } }]);
    const pending = await service.listPending();
    expect(pending.map((c: any) => c.id)).toEqual(['c-2']);
  });

  it('settles + surfaces activated terminal states — TERMINATED/EXCHANGED/DEFECT_EXCHANGED/CLOSED_BAD_DEBT (owner decision 2026-06-23)', async () => {
    // A contract that reached a terminal state still owes the FINANCE→SHOP receivable
    // (S11-3001/3002) booked at activation, so it stays settleable + visible in pending.
    prisma.contract.findMany.mockResolvedValue([
      { id: 't-1', contractNumber: 'CN-T', financedAmount: new Decimal('5000'), storeCommission: null, status: 'TERMINATED', deletedAt: null },
    ]);
    await service.settle({ contractIds: ['t-1'] });
    const settleWhere = prisma.contract.findMany.mock.calls[0][0].where;
    expect(settleWhere.status.in).toEqual(
      expect.arrayContaining(['TERMINATED', 'EXCHANGED', 'DEFECT_EXCHANGED', 'CLOSED_BAD_DEBT']),
    );
    // DRAFT + CANCELED stay excluded
    expect(settleWhere.status.in).not.toContain('DRAFT');
    expect(settleWhere.status.in).not.toContain('CANCELED');
    expect(template.execute).toHaveBeenCalledTimes(1);
    expect(template.execute.mock.calls[0][0]).toMatchObject({ idempotencyKey: 'finance-receipt-t-1' });
    expect(template.execute.mock.calls[0][0].commission.toString()).toBe('0');
  });
});
