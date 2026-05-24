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

  const cost = new Decimal('12345.67');

  it('posts Dr S11-2002 / Cr S50-1102 at the supplied cost', async () => {
    const result = await template.execute({
      oldProductId: 'p-1',
      oldContractId: 'c-1',
      cost,
    });
    expect(result).toEqual({ id: 'je-id', entryNumber: 'JE-202605-00001' });
    expect(journal.createAndPost).toHaveBeenCalledTimes(1);
    const call = journal.createAndPost.mock.calls[0][0];
    expect(call.lines).toEqual([
      expect.objectContaining({
        accountCode: 'S11-2002',
        dr: cost,
      }),
      expect.objectContaining({
        accountCode: 'S50-1102',
        cr: cost,
      }),
    ]);
    // Both lines have zero on the other side — strict accounting balance check
    expect(call.lines[0].cr.toString()).toBe('0');
    expect(call.lines[1].dr.toString()).toBe('0');
  });

  it('tags the JE with companyId=SHOP', async () => {
    await template.execute({ oldProductId: 'p-1', oldContractId: 'c-1', cost });
    const call = journal.createAndPost.mock.calls[0][0];
    expect(call.companyId).toBe('shop-co-id');
    expect(companyResolver.getShopCompanyId).toHaveBeenCalled();
  });

  it('stamps idempotencyKey = oldProductId:oldContractId on metadata', async () => {
    await template.execute({ oldProductId: 'p-1', oldContractId: 'c-1', cost });
    const call = journal.createAndPost.mock.calls[0][0];
    expect(call.metadata).toMatchObject({
      flow: 'shop-exchange-return',
      idempotencyKey: 'p-1:c-1',
      oldProductId: 'p-1',
      oldContractId: 'c-1',
      companyCode: 'SHOP',
    });
  });

  it('sets a contract reference for cross-linking from reports', async () => {
    await template.execute({ oldProductId: 'p-1', oldContractId: 'c-1', cost });
    const call = journal.createAndPost.mock.calls[0][0];
    expect(call.reference).toBe('contract:c-1:exchange-return');
  });

  it('throws InternalServerErrorException when cost = 0', async () => {
    await expect(
      template.execute({ oldProductId: 'p-1', oldContractId: 'c-1', cost: new Decimal(0) }),
    ).rejects.toThrow(InternalServerErrorException);
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('throws InternalServerErrorException when cost is negative', async () => {
    await expect(
      template.execute({ oldProductId: 'p-1', oldContractId: 'c-1', cost: new Decimal(-1) }),
    ).rejects.toThrow(InternalServerErrorException);
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('propagates the outer transaction client when provided', async () => {
    const fakeTx = { __tag: 'tx' } as any;
    await template.execute({ oldProductId: 'p-1', oldContractId: 'c-1', cost }, fakeTx);
    expect(journal.createAndPost).toHaveBeenCalledWith(expect.anything(), fakeTx);
    expect(companyResolver.getShopCompanyId).toHaveBeenCalledWith(fakeTx);
  });
});
