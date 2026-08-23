import { Prisma } from '@prisma/client';
import { ShopCashSaleTemplate } from '../cpa-templates/shop-cash-sale.template';
import {
  makeMockJournalAuto,
  makeMockPrisma,
  makeMockCompanyResolver,
  seedExistingJournalEntry,
} from './test-helpers';

describe('ShopCashSaleTemplate (unit)', () => {
  function build() {
    const journal = makeMockJournalAuto();
    const prisma = makeMockPrisma();
    const resolver = makeMockCompanyResolver();
    const template = new ShopCashSaleTemplate(
      journal.service,
      prisma.prisma,
      resolver,
    );
    return { template, journal, prisma, resolver };
  }

  it('posts cash sale + COGS pair — balanced', async () => {
    const { template, journal } = build();
    await template.execute({
      idempotencyKey: 'sale-1',
      saleId: 'sale-001',
      productId: 'prod-001',
      cashAccountCode: 'S11-1101',
      revenueAccountCode: 'S41-1101',
      revenueAmount: new Prisma.Decimal(15000),
      cogsAccountCode: 'S50-1101',
      inventoryAccountCode: 'S11-2001',
      inventoryCost: new Prisma.Decimal(11000),
    });
    const lines = journal.state.lastInput!.lines;
    expect(lines).toHaveLength(4);
    const sumDr = lines.reduce((s, l) => s.plus(l.dr), new Prisma.Decimal(0));
    const sumCr = lines.reduce((s, l) => s.plus(l.cr), new Prisma.Decimal(0));
    expect(sumDr.toFixed(2)).toBe(sumCr.toFixed(2));
    expect(lines.find((l) => l.accountCode === 'S11-1101')!.dr.toFixed(2)).toBe('15000.00');
    expect(lines.find((l) => l.accountCode === 'S41-1101')!.cr.toFixed(2)).toBe('15000.00');
    expect(lines.find((l) => l.accountCode === 'S50-1101')!.dr.toFixed(2)).toBe('11000.00');
    expect(lines.find((l) => l.accountCode === 'S11-2001')!.cr.toFixed(2)).toBe('11000.00');
  });

  // F1 regression (2026-08-23): journal_entries_ref_unique is a partial unique
  // index on (reference_type, reference_id) — a shared per-sale reference made
  // the SECOND JE of a bundle cash sale collide (P2002) and the whole POS sale
  // fail. The reference must be unique per (sale, product).
  it('reference is unique per (sale, product) — bundle JEs must not collide on journal_entries_ref_unique', async () => {
    const { template, journal } = build();
    const base = {
      saleId: 'sale-009',
      cashAccountCode: 'S11-1101',
      revenueAccountCode: 'S41-1101',
      cogsAccountCode: 'S50-1101',
      inventoryAccountCode: 'S11-2001',
    };
    const refs: string[] = [];
    for (const [productId, revenue, cost] of [
      ['prod-main', 9400, 6000],
      ['prod-freebie', 500, 500],
    ] as const) {
      await template.execute({
        ...base,
        idempotencyKey: `shop-cash-sale:sale-009:${productId}`,
        productId,
        revenueAmount: new Prisma.Decimal(revenue),
        inventoryCost: new Prisma.Decimal(cost),
      });
      const input = (journal.service.createAndPost as jest.Mock).mock.calls.at(-1)![0] as {
        reference?: string;
      };
      refs.push(input.reference!);
    }
    expect(refs).toEqual(['sale:sale-009:prod-main', 'sale:sale-009:prod-freebie']);
    expect(new Set(refs).size).toBe(2);
  });

  it('omits COGS pair when inventoryCost is zero (promo give-away)', async () => {
    const { template, journal } = build();
    await template.execute({
      idempotencyKey: 'sale-2',
      saleId: 'sale-002',
      productId: 'prod-002',
      cashAccountCode: 'S11-1101',
      revenueAccountCode: 'S41-1103',
      revenueAmount: new Prisma.Decimal(500),
      cogsAccountCode: 'S50-1103',
      inventoryAccountCode: 'S11-2003',
      inventoryCost: new Prisma.Decimal(0),
    });
    const lines = journal.state.lastInput!.lines;
    expect(lines).toHaveLength(2);
  });

  it('rejects negative inventoryCost', async () => {
    const { template } = build();
    await expect(
      template.execute({
        idempotencyKey: 'sale-3',
        saleId: 'sale-003',
      productId: 'prod-003',
        cashAccountCode: 'S11-1101',
        revenueAccountCode: 'S41-1101',
        revenueAmount: new Prisma.Decimal(100),
        cogsAccountCode: 'S50-1101',
        inventoryAccountCode: 'S11-2001',
        inventoryCost: new Prisma.Decimal(-1),
      }),
    ).rejects.toThrow(/cannot be negative/);
  });

  it('rejects a FINANCE-side cash account', async () => {
    const { template } = build();
    await expect(
      template.execute({
        idempotencyKey: 'sale-4',
        saleId: 'sale-004',
      productId: 'prod-004',
        cashAccountCode: '11-1101',
        revenueAccountCode: 'S41-1101',
        revenueAmount: new Prisma.Decimal(100),
        cogsAccountCode: 'S50-1101',
        inventoryAccountCode: 'S11-2001',
        inventoryCost: new Prisma.Decimal(50),
      }),
    ).rejects.toThrow(/SHOP-side/);
  });

  it('is idempotent', async () => {
    const { template, prisma, journal } = build();
    seedExistingJournalEntry(prisma.state, 'shop-cash-sale', 'sale-5', 'existing', 'JE-X');
    const r = await template.execute({
      idempotencyKey: 'sale-5',
      saleId: 'sale-005',
      productId: 'prod-005',
      cashAccountCode: 'S11-1101',
      revenueAccountCode: 'S41-1101',
      revenueAmount: new Prisma.Decimal(100),
      cogsAccountCode: 'S50-1101',
      inventoryAccountCode: 'S11-2001',
      inventoryCost: new Prisma.Decimal(50),
    });
    expect(r.journalEntryId).toBe('existing');
    expect(journal.state.callCount).toBe(0);
  });
});
