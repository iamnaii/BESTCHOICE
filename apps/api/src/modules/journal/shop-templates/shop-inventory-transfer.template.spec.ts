import { Prisma } from '@prisma/client';
import { ShopInventoryTransferTemplate } from '../cpa-templates/shop-inventory-transfer.template';
import {
  makeMockJournalAuto,
  makeMockPrisma,
  makeMockCompanyResolver,
  seedExistingJournalEntry,
  seedExistingJournalEntryByBatch,
} from './test-helpers';

/**
 * P3-SP5 DEEP review C2 — re-derived ShopInventoryTransferTemplate.
 *
 * Posts TWO JEs in one $transaction:
 *   JE A — COGS: Dr S50-XXXX / Cr S11-200X (costPrice)
 *   JE B — Revenue: Dr S11-3001 + Dr S11-3002 + Dr S21-2001 /
 *                   Cr S41-XXXX + Cr S41-1201
 *
 * Both balance independently. Critical invariant:
 *   financedAmount + downAmount === salePrice
 */
describe('ShopInventoryTransferTemplate (unit — C2 redesign)', () => {
  function build() {
    const journal = makeMockJournalAuto();
    const prisma = makeMockPrisma();
    const resolver = makeMockCompanyResolver();
    const template = new ShopInventoryTransferTemplate(
      journal.service,
      prisma.prisma,
      resolver,
    );
    return { template, journal, prisma, resolver };
  }

  it('posts BOTH COGS + revenue JEs in one $tx — both balanced', async () => {
    const { template, journal } = build();
    const r = await template.execute({
      idempotencyKey: 'inv-1',
      contractId: 'c1',
      productId: 'p1',
      inventoryAccountCode: 'S11-2001',
      cogsAccountCode: 'S50-1101',
      revenueAccountCode: 'S41-1101',
      costPrice: new Prisma.Decimal(11000),
      salePrice: new Prisma.Decimal(15000),
      downAmount: new Prisma.Decimal(3000),
      financedAmount: new Prisma.Decimal(12000),
      commission: new Prisma.Decimal(1500),
    });
    expect(journal.state.callCount).toBe(2);
    expect(r.cogsJournalEntryId).toBeDefined();
    expect(r.revenueJournalEntryId).toBeDefined();
    expect(r.cogsJournalEntryId).not.toEqual(r.revenueJournalEntryId);
    expect(r.batchId).toBeTruthy();
    // Last input is the revenue leg
    const revLines = journal.state.lastInput!.lines;
    const sumDr = revLines.reduce((s, l) => s.plus(l.dr), new Prisma.Decimal(0));
    const sumCr = revLines.reduce((s, l) => s.plus(l.cr), new Prisma.Decimal(0));
    expect(sumDr.toFixed(2)).toBe(sumCr.toFixed(2));
    // Revenue leg checks
    expect(revLines.find((l) => l.accountCode === 'S11-3001')!.dr.toFixed(2)).toBe('12000.00');
    expect(revLines.find((l) => l.accountCode === 'S11-3002')!.dr.toFixed(2)).toBe('1500.00');
    expect(revLines.find((l) => l.accountCode === 'S21-2001')!.dr.toFixed(2)).toBe('3000.00');
    expect(revLines.find((l) => l.accountCode === 'S41-1101')!.cr.toFixed(2)).toBe('15000.00');
    expect(revLines.find((l) => l.accountCode === 'S41-1201')!.cr.toFixed(2)).toBe('1500.00');
  });

  it('CRITICAL — throws when financed + down !== salePrice', async () => {
    const { template, journal } = build();
    await expect(
      template.execute({
        idempotencyKey: 'inv-2',
        contractId: 'c2',
        productId: 'p2',
        inventoryAccountCode: 'S11-2001',
        cogsAccountCode: 'S50-1101',
        revenueAccountCode: 'S41-1101',
        costPrice: new Prisma.Decimal(10000),
        salePrice: new Prisma.Decimal(15000),
        downAmount: new Prisma.Decimal(3000),
        financedAmount: new Prisma.Decimal(11000), // wrong — should be 12000
        commission: new Prisma.Decimal(1500),
      }),
    ).rejects.toThrow(/must equal salePrice/);
    // Nothing posted
    expect(journal.state.callCount).toBe(0);
  });

  it('throws when costPrice <= 0', async () => {
    const { template } = build();
    await expect(
      template.execute({
        idempotencyKey: 'inv-3',
        contractId: 'c3',
        productId: 'p3',
        inventoryAccountCode: 'S11-2001',
        cogsAccountCode: 'S50-1101',
        revenueAccountCode: 'S41-1101',
        costPrice: new Prisma.Decimal(0),
        salePrice: new Prisma.Decimal(15000),
        downAmount: new Prisma.Decimal(3000),
        financedAmount: new Prisma.Decimal(12000),
        commission: new Prisma.Decimal(1500),
      }),
    ).rejects.toThrow(/costPrice must be > 0/);
  });

  it('rejects FINANCE-side account codes', async () => {
    const { template } = build();
    await expect(
      template.execute({
        idempotencyKey: 'inv-4',
        contractId: 'c4',
        productId: 'p4',
        inventoryAccountCode: '11-2001',
        cogsAccountCode: 'S50-1101',
        revenueAccountCode: 'S41-1101',
        costPrice: new Prisma.Decimal(1000),
        salePrice: new Prisma.Decimal(1000),
        downAmount: new Prisma.Decimal(0),
        financedAmount: new Prisma.Decimal(1000),
        commission: new Prisma.Decimal(0),
      }),
    ).rejects.toThrow(/SHOP-side/);
  });

  it('zero commission produces revenue leg without commission lines', async () => {
    const { template, journal } = build();
    await template.execute({
      idempotencyKey: 'inv-5',
      contractId: 'c5',
      productId: 'p5',
      inventoryAccountCode: 'S11-2001',
      cogsAccountCode: 'S50-1101',
      revenueAccountCode: 'S41-1101',
      costPrice: new Prisma.Decimal(8000),
      salePrice: new Prisma.Decimal(10000),
      downAmount: new Prisma.Decimal(2000),
      financedAmount: new Prisma.Decimal(8000),
      commission: new Prisma.Decimal(0),
    });
    // Revenue leg should have NO S11-3002 / S41-1201 lines
    const revLines = journal.state.lastInput!.lines;
    expect(revLines.find((l) => l.accountCode === 'S11-3002')).toBeUndefined();
    expect(revLines.find((l) => l.accountCode === 'S41-1201')).toBeUndefined();
    // Still balanced
    const sumDr = revLines.reduce((s, l) => s.plus(l.dr), new Prisma.Decimal(0));
    const sumCr = revLines.reduce((s, l) => s.plus(l.cr), new Prisma.Decimal(0));
    expect(sumDr.toFixed(2)).toBe(sumCr.toFixed(2));
  });

  it('is idempotent on COGS leg + finds paired revenue leg by batchId', async () => {
    const { template, journal, prisma } = build();
    seedExistingJournalEntry(
      prisma.state,
      'shop-inventory-transfer-cogs',
      'inv-6',
      'cogs-existing',
      'JE-COGS',
      { batchId: 'batch-existing' },
    );
    seedExistingJournalEntryByBatch(
      prisma.state,
      'batch-existing',
      'rev-existing',
      'JE-REV',
    );
    const r = await template.execute({
      idempotencyKey: 'inv-6',
      contractId: 'c6',
      productId: 'p6',
      inventoryAccountCode: 'S11-2001',
      cogsAccountCode: 'S50-1101',
      revenueAccountCode: 'S41-1101',
      costPrice: new Prisma.Decimal(1),
      salePrice: new Prisma.Decimal(1),
      downAmount: new Prisma.Decimal(0),
      financedAmount: new Prisma.Decimal(1),
      commission: new Prisma.Decimal(0),
    });
    expect(r.cogsJournalEntryId).toBe('cogs-existing');
    expect(r.revenueJournalEntryId).toBe('rev-existing');
    expect(journal.state.callCount).toBe(0);
  });

  it('throws if COGS leg exists but revenue leg missing (partial)', async () => {
    const { template, prisma } = build();
    seedExistingJournalEntry(
      prisma.state,
      'shop-inventory-transfer-cogs',
      'inv-7',
      'cogs-existing',
      'JE-COGS',
      { batchId: 'batch-orphan' },
    );
    // Intentionally DO NOT seed revenue leg
    await expect(
      template.execute({
        idempotencyKey: 'inv-7',
        contractId: 'c7',
        productId: 'p7',
        inventoryAccountCode: 'S11-2001',
        cogsAccountCode: 'S50-1101',
        revenueAccountCode: 'S41-1101',
        costPrice: new Prisma.Decimal(1),
        salePrice: new Prisma.Decimal(1),
        downAmount: new Prisma.Decimal(0),
        financedAmount: new Prisma.Decimal(1),
        commission: new Prisma.Decimal(0),
      }),
    ).rejects.toThrow(/revenue leg missing/);
  });
});
