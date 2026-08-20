import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ShopExchangeReturnTemplate } from './cpa-templates/shop-exchange-return.template';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyResolverService } from './company-resolver.service';

describe('ShopExchangeReturnTemplate', () => {
  let template: ShopExchangeReturnTemplate;
  let journal: any;
  let companyResolver: any;

  beforeEach(async () => {
    journal = {
      createAndPost: jest.fn().mockResolvedValue({ id: 'je-id', entryNumber: 'JE-202605-00001' }),
    };
    companyResolver = {
      getShopCompanyId: jest.fn().mockResolvedValue('shop-co-id'),
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        ShopExchangeReturnTemplate,
        { provide: JournalAutoService, useValue: journal },
        { provide: PrismaService, useValue: {} },
        { provide: CompanyResolverService, useValue: companyResolver },
      ],
    }).compile();
    template = mod.get(ShopExchangeReturnTemplate);
  });

  const buyback = new Decimal('12345.67');

  it('posts Dr S11-2002 / Cr S21-3001 at the supplied buyback price (workbook 2026-08-19)', async () => {
    const result = await template.execute({
      oldProductId: 'p-1',
      oldContractId: 'c-1',
      requestId: 'req-1',
      buyback,
      newContractId: 'new-contract-1',
    });
    expect(result).toEqual({ id: 'je-id', entryNumber: 'JE-202605-00001' });
    expect(journal.createAndPost).toHaveBeenCalledTimes(1);
    const call = journal.createAndPost.mock.calls[0][0];
    expect(call.lines).toEqual([
      expect.objectContaining({
        accountCode: 'S11-2002',
        dr: buyback,
      }),
      expect.objectContaining({
        accountCode: 'S21-3001',
        cr: buyback,
      }),
    ]);
    // Both lines have zero on the other side — strict accounting balance check
    expect(call.lines[0].cr.toString()).toBe('0');
    expect(call.lines[1].dr.toString()).toBe('0');
    // The retired cost-reversal leg must never come back
    expect(call.lines.some((l: any) => l.accountCode === 'S50-1102')).toBe(false);
  });

  it('tags the JE with companyId=SHOP', async () => {
    await template.execute({
      oldProductId: 'p-1',
      oldContractId: 'c-1',
      requestId: 'req-1',
      buyback,
      newContractId: 'new-contract-1',
    });
    const call = journal.createAndPost.mock.calls[0][0];
    expect(call.companyId).toBe('shop-co-id');
    expect(companyResolver.getShopCompanyId).toHaveBeenCalled();
  });

  it('stamps request-scoped idempotencyKey = oldProductId:oldContractId:requestId on metadata (C1b)', async () => {
    await template.execute({
      oldProductId: 'p-1',
      oldContractId: 'c-1',
      requestId: 'req-1',
      buyback,
      newContractId: 'new-contract-1',
    });
    const call = journal.createAndPost.mock.calls[0][0];
    expect(call.metadata).toMatchObject({
      flow: 'shop-exchange-return',
      idempotencyKey: 'p-1:c-1:req-1',
      oldProductId: 'p-1',
      oldContractId: 'c-1',
      // 2026-08-19: contractId (= old contract) so glContractBalance sees the
      // S21-3001 leg; SWAP_CREDIT pairs it with 11-2107 on the FINANCE side.
      contractId: 'c-1',
      companyCode: 'SHOP',
      buyback: '12345.67',
      shopReceivableType: 'SWAP_CREDIT',
    });
    // Phase 2 Task 1: the SHOP netting lens (Task 3) keys S21-3001 by the NEW
    // contract — batch item = สัญญาใหม่ — so A.4 must stamp it directly.
    expect((call.metadata as any).newContractId).toBe('new-contract-1');
  });

  it('sets a request-scoped contract reference for cross-linking from reports (C1b)', async () => {
    await template.execute({
      oldProductId: 'p-1',
      oldContractId: 'c-1',
      requestId: 'req-1',
      buyback,
      newContractId: 'new-contract-1',
    });
    const call = journal.createAndPost.mock.calls[0][0];
    // requestId suffix: (referenceType, referenceId) is DB-unique — round 2
    // after a cancel must not collide with the still-POSTED first A.4.
    expect(call.reference).toBe('contract:c-1:exchange-return:req-1');
  });

  it('throws InternalServerErrorException when buyback = 0', async () => {
    await expect(
      template.execute({
        oldProductId: 'p-1',
        oldContractId: 'c-1',
        requestId: 'req-1',
        buyback: new Decimal(0),
        newContractId: 'new-contract-1',
      }),
    ).rejects.toThrow(InternalServerErrorException);
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('throws InternalServerErrorException when buyback is negative', async () => {
    await expect(
      template.execute({
        oldProductId: 'p-1',
        oldContractId: 'c-1',
        requestId: 'req-1',
        buyback: new Decimal(-1),
        newContractId: 'new-contract-1',
      }),
    ).rejects.toThrow(InternalServerErrorException);
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('propagates the outer transaction client when provided', async () => {
    const fakeTx = { __tag: 'tx' } as any;
    await template.execute(
      { oldProductId: 'p-1', oldContractId: 'c-1', requestId: 'req-1', buyback, newContractId: 'new-contract-1' },
      fakeTx,
    );
    expect(journal.createAndPost).toHaveBeenCalledWith(expect.anything(), fakeTx);
    expect(companyResolver.getShopCompanyId).toHaveBeenCalledWith(fakeTx);
  });
});
