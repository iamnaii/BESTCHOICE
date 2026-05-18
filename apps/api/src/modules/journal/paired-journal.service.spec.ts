import { Test, TestingModule } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { PairedJournalService } from './paired-journal.service';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyResolverService } from './company-resolver.service';

describe('PairedJournalService.postPaired', () => {
  let service: PairedJournalService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let journal: any;

  const SHOP_ID = 'company-shop';
  const FINANCE_ID = 'company-finance';

  beforeEach(async () => {
    // Capture both calls to journal.createAndPost so tests can assert on them.
    journal = {
      createAndPost: jest
        .fn()
        .mockResolvedValueOnce({ id: 'je-shop-1', entryNumber: 'JE-202605-00001' })
        .mockResolvedValueOnce({ id: 'je-fin-1', entryNumber: 'JE-202605-00002' }),
    };
    prisma = {
      companyInfo: {
        findFirst: jest.fn().mockImplementation(({ where }: { where: { companyCode: string } }) =>
          Promise.resolve(
            where.companyCode === 'SHOP'
              ? { id: SHOP_ID }
              : where.companyCode === 'FINANCE'
                ? { id: FINANCE_ID }
                : null,
          ),
        ),
      },
      $transaction: jest
        .fn()
        // run the supplied callback with the same mocked prisma (acts as tx)
        .mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    // Lightweight stand-in for CompanyResolverService — delegates to the
    // mocked prisma so the same `companyInfo.findFirst` assertions still
    // fire from the prisma.companyInfo.findFirst spy.
    const resolver = {
      getShopCompanyId: jest.fn().mockImplementation((tx?: { companyInfo?: { findFirst: jest.Mock } }) => {
        const client = tx ?? prisma;
        return client.companyInfo
          .findFirst({ where: { companyCode: 'SHOP' } })
          .then((co: { id?: string } | null) => {
            if (!co) throw new Error('SHOP CompanyInfo not found');
            return co.id;
          });
      }),
      getFinanceCompanyId: jest.fn().mockImplementation((tx?: { companyInfo?: { findFirst: jest.Mock } }) => {
        const client = tx ?? prisma;
        return client.companyInfo
          .findFirst({ where: { companyCode: 'FINANCE' } })
          .then((co: { id?: string } | null) => {
            if (!co) throw new Error('FINANCE CompanyInfo not found');
            return co.id;
          });
      }),
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        PairedJournalService,
        { provide: JournalAutoService, useValue: journal },
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyResolverService, useValue: resolver },
      ],
    }).compile();
    service = mod.get(PairedJournalService);
  });

  function shopHalf(): Parameters<PairedJournalService['postPaired']>[0]['shop'] {
    return {
      companyCode: 'SHOP',
      description: 'SHOP test',
      lines: [
        { accountCode: 'S11-1101', dr: new Decimal(100), cr: new Decimal(0) },
        { accountCode: 'S41-1101', dr: new Decimal(0), cr: new Decimal(100) },
      ],
    };
  }

  function financeHalf(): Parameters<PairedJournalService['postPaired']>[0]['finance'] {
    return {
      companyCode: 'FINANCE',
      description: 'FINANCE test',
      lines: [
        { accountCode: '11-2101', dr: new Decimal(100), cr: new Decimal(0) },
        { accountCode: '21-1101', dr: new Decimal(0), cr: new Decimal(100) },
      ],
    };
  }

  it('posts both SHOP and FINANCE JEs in one transaction, with shared batchId', async () => {
    const result = await service.postPaired({
      shop: shopHalf(),
      finance: financeHalf(),
      batchRef: 'contract-X1',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(journal.createAndPost).toHaveBeenCalledTimes(2);
    expect(result.batchId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.shopEntryNumber).toBe('JE-202605-00001');
    expect(result.financeEntryNumber).toBe('JE-202605-00002');

    // Both halves must carry the SAME batchId + correct companyId
    const shopCall = journal.createAndPost.mock.calls[0][0];
    const financeCall = journal.createAndPost.mock.calls[1][0];
    expect(shopCall.companyId).toBe(SHOP_ID);
    expect(financeCall.companyId).toBe(FINANCE_ID);
    expect(shopCall.metadata.batchId).toBe(result.batchId);
    expect(financeCall.metadata.batchId).toBe(result.batchId);
    expect(shopCall.metadata.batchSide).toBe('SHOP');
    expect(financeCall.metadata.batchSide).toBe('FINANCE');
    expect(shopCall.metadata.batchRef).toBe('contract-X1');
    expect(financeCall.metadata.batchRef).toBe('contract-X1');
    expect(financeCall.metadata.pairedWithJournalEntryId).toBe('je-shop-1');
  });

  it('rejects when SHOP half is unbalanced', async () => {
    const shop = shopHalf();
    shop.lines[1].cr = new Decimal(50); // Dr 100, Cr 50
    await expect(
      service.postPaired({ shop, finance: financeHalf() }),
    ).rejects.toThrow(/shop half unbalanced/i);
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('rejects when FINANCE half is unbalanced', async () => {
    const finance = financeHalf();
    finance.lines[0].dr = new Decimal(150);
    await expect(
      service.postPaired({ shop: shopHalf(), finance }),
    ).rejects.toThrow(/finance half unbalanced/i);
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('rejects when SHOP half has wrong companyCode', async () => {
    const shop = shopHalf();
    (shop as { companyCode: string }).companyCode = 'FINANCE';
    await expect(
      service.postPaired({
        shop: shop as Parameters<PairedJournalService['postPaired']>[0]['shop'],
        finance: financeHalf(),
      }),
    ).rejects.toThrow(/shop half must have companyCode=SHOP/);
  });

  it('rejects when SHOP company is missing from DB', async () => {
    prisma.companyInfo.findFirst = jest.fn().mockResolvedValue(null);
    await expect(
      service.postPaired({ shop: shopHalf(), finance: financeHalf() }),
    ).rejects.toThrow(/SHOP CompanyInfo not found/i);
  });

  it('uses outerTx when supplied (does not start a new $transaction)', async () => {
    // outerTx mimics prisma — same shape for companyInfo.findFirst
    const outerTx = {
      companyInfo: {
        findFirst: jest.fn().mockImplementation(({ where }: { where: { companyCode: string } }) =>
          Promise.resolve(where.companyCode === 'SHOP' ? { id: SHOP_ID } : { id: FINANCE_ID }),
        ),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.postPaired({ shop: shopHalf(), finance: financeHalf() }, outerTx as any);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(journal.createAndPost).toHaveBeenCalledTimes(2);
    // Both createAndPost calls received outerTx, not the root prisma
    expect(journal.createAndPost.mock.calls[0][1]).toBe(outerTx);
    expect(journal.createAndPost.mock.calls[1][1]).toBe(outerTx);
  });
});
