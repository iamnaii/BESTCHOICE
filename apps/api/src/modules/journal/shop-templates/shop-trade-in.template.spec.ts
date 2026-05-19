import { Prisma } from '@prisma/client';
import { ShopTradeInTemplate } from '../cpa-templates/shop-trade-in.template';
import {
  makeMockJournalAuto,
  makeMockPrisma,
  makeMockCompanyResolver,
  seedExistingJournalEntry,
} from './test-helpers';

describe('ShopTradeInTemplate (unit)', () => {
  function build() {
    const journal = makeMockJournalAuto();
    const prisma = makeMockPrisma();
    const resolver = makeMockCompanyResolver();
    const template = new ShopTradeInTemplate(
      journal.service,
      prisma.prisma,
      resolver,
    );
    return { template, journal, prisma, resolver };
  }

  it('defaults inventory account to S11-2002 (sellable used) — balanced', async () => {
    const { template, journal } = build();
    await template.execute({
      idempotencyKey: 'tradein-1',
      tradeInId: 'ti-1',
      cashAccountCode: 'S11-1101',
      tradeInPrice: new Prisma.Decimal(5000),
    });
    const lines = journal.state.lastInput!.lines;
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.accountCode === 'S11-2002')!.dr.toFixed(2)).toBe('5000.00');
    expect(lines.find((l) => l.accountCode === 'S11-1101')!.cr.toFixed(2)).toBe('5000.00');
    expect(journal.state.lastInput!.companyId).toBe('shop-co-id');
  });

  it('W4 — accepts S11-2004 inventoryAccountCode override (pending evaluation)', async () => {
    const { template, journal } = build();
    await template.execute({
      idempotencyKey: 'tradein-2',
      tradeInId: 'ti-2',
      cashAccountCode: 'S11-1201',
      tradeInPrice: new Prisma.Decimal(2500),
      inventoryAccountCode: 'S11-2004',
    });
    const lines = journal.state.lastInput!.lines;
    expect(lines.find((l) => l.accountCode === 'S11-2004')!.dr.toFixed(2)).toBe('2500.00');
    expect(lines.find((l) => l.accountCode === 'S11-2002')).toBeUndefined();
    const meta = journal.state.lastInput!.metadata as { inventoryAccountCode: string };
    expect(meta.inventoryAccountCode).toBe('S11-2004');
  });

  it('W4 — rejects unknown inventoryAccountCode (must be S11-2002 or S11-2004)', async () => {
    const { template } = build();
    await expect(
      template.execute({
        idempotencyKey: 'tradein-3',
        tradeInId: 'ti-3',
        cashAccountCode: 'S11-1101',
        tradeInPrice: new Prisma.Decimal(100),
        inventoryAccountCode: 'S11-3001',
      }),
    ).rejects.toThrow(/S11-2002.*S11-2004/);
  });

  it('throws when tradeInPrice <= 0', async () => {
    const { template } = build();
    await expect(
      template.execute({
        idempotencyKey: 'tradein-4',
        tradeInId: 'ti-4',
        cashAccountCode: 'S11-1101',
        tradeInPrice: new Prisma.Decimal(0),
      }),
    ).rejects.toThrow(/tradeInPrice must be > 0/);
  });

  it('rejects FINANCE-side cash account', async () => {
    const { template } = build();
    await expect(
      template.execute({
        idempotencyKey: 'tradein-5',
        tradeInId: 'ti-5',
        cashAccountCode: '11-1101',
        tradeInPrice: new Prisma.Decimal(100),
      }),
    ).rejects.toThrow(/SHOP-side/);
  });

  it('is idempotent', async () => {
    const { template, prisma, journal } = build();
    seedExistingJournalEntry(prisma.state, 'shop-trade-in', 'tradein-6', 'existing', 'JE-X');
    const r = await template.execute({
      idempotencyKey: 'tradein-6',
      tradeInId: 'ti-6',
      cashAccountCode: 'S11-1101',
      tradeInPrice: new Prisma.Decimal(100),
    });
    expect(r.journalEntryId).toBe('existing');
    expect(journal.state.callCount).toBe(0);
  });
});
