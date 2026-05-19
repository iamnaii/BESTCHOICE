import { Prisma } from '@prisma/client';
import { ShopFinanceReceiptTemplate } from '../cpa-templates/shop-finance-receipt.template';
import {
  makeMockJournalAuto,
  makeMockPrisma,
  makeMockCompanyResolver,
  seedExistingJournalEntry,
} from './test-helpers';

/**
 * P3-SP5 DEEP review C1 — re-derived ShopFinanceReceiptTemplate.
 *
 * The OLD design tried to recognise revenue + COGS + down-clearance inside
 * THIS template, which made the JE unbalanced (Dr financed+commission+down
 * vs Cr financed+commission+salePrice+commission+cost). The new design is
 * a simple cash-in / receivable-clearance JE only — revenue is handled by
 * ShopInventoryTransferTemplate at activation time.
 *
 * These tests prove the new template:
 *   - Books only Dr bank + Cr S11-3001 + Cr S11-3002 (no revenue, no COGS)
 *   - Always balances (Dr = financed + commission = Cr)
 *   - Rejects negative or zero totals
 *   - Is idempotent
 */
describe('ShopFinanceReceiptTemplate (unit — C1 redesign)', () => {
  function build() {
    const journal = makeMockJournalAuto();
    const prisma = makeMockPrisma();
    const resolver = makeMockCompanyResolver();
    const template = new ShopFinanceReceiptTemplate(
      journal.service,
      prisma.prisma,
      resolver,
    );
    return { template, journal, prisma, resolver };
  }

  it('books Dr bank + Cr S11-3001 + Cr S11-3002 — balanced', async () => {
    const { template, journal } = build();
    await template.execute({
      idempotencyKey: 'fr-1',
      contractId: 'c1',
      bankAccountCode: 'S11-1201',
      financedAmount: new Prisma.Decimal(12000),
      commission: new Prisma.Decimal(1500),
    });
    const lines = journal.state.lastInput!.lines;
    expect(lines).toHaveLength(3);
    // Bank Dr = financed + commission = 13500
    const bank = lines.find((l) => l.accountCode === 'S11-1201')!;
    expect(bank.dr.toFixed(2)).toBe('13500.00');
    // Receivable principal cleared
    const rec1 = lines.find((l) => l.accountCode === 'S11-3001')!;
    expect(rec1.cr.toFixed(2)).toBe('12000.00');
    // Receivable commission cleared
    const rec2 = lines.find((l) => l.accountCode === 'S11-3002')!;
    expect(rec2.cr.toFixed(2)).toBe('1500.00');
    // Balance check
    const sumDr = lines.reduce((s, l) => s.plus(l.dr), new Prisma.Decimal(0));
    const sumCr = lines.reduce((s, l) => s.plus(l.cr), new Prisma.Decimal(0));
    expect(sumDr.toFixed(2)).toBe(sumCr.toFixed(2));
    // CRITICAL — must NOT post revenue or COGS lines (old C1 bug)
    expect(lines.find((l) => l.accountCode.startsWith('S41'))).toBeUndefined();
    expect(lines.find((l) => l.accountCode.startsWith('S50'))).toBeUndefined();
    expect(lines.find((l) => l.accountCode === 'S21-2001')).toBeUndefined();
  });

  it('zero commission — only books bank + financed receivable clearance', async () => {
    const { template, journal } = build();
    await template.execute({
      idempotencyKey: 'fr-2',
      contractId: 'c2',
      bankAccountCode: 'S11-1201',
      financedAmount: new Prisma.Decimal(8000),
      commission: new Prisma.Decimal(0),
    });
    const lines = journal.state.lastInput!.lines;
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.accountCode === 'S11-3002')).toBeUndefined();
  });

  it('rejects total <= 0 (both zero)', async () => {
    const { template } = build();
    await expect(
      template.execute({
        idempotencyKey: 'fr-3',
        contractId: 'c3',
        bankAccountCode: 'S11-1201',
        financedAmount: new Prisma.Decimal(0),
        commission: new Prisma.Decimal(0),
      }),
    ).rejects.toThrow(/must be > 0/);
  });

  it('rejects negative financedAmount', async () => {
    const { template } = build();
    await expect(
      template.execute({
        idempotencyKey: 'fr-4',
        contractId: 'c4',
        bankAccountCode: 'S11-1201',
        financedAmount: new Prisma.Decimal(-100),
        commission: new Prisma.Decimal(50),
      }),
    ).rejects.toThrow(/cannot be negative/);
  });

  it('rejects FINANCE-side bankAccountCode', async () => {
    const { template } = build();
    await expect(
      template.execute({
        idempotencyKey: 'fr-5',
        contractId: 'c5',
        bankAccountCode: '11-1201',
        financedAmount: new Prisma.Decimal(100),
        commission: new Prisma.Decimal(10),
      }),
    ).rejects.toThrow(/SHOP-side/);
  });

  it('is idempotent', async () => {
    const { template, prisma, journal } = build();
    seedExistingJournalEntry(prisma.state, 'shop-finance-receipt', 'fr-6', 'existing', 'JE-X');
    const r = await template.execute({
      idempotencyKey: 'fr-6',
      contractId: 'c6',
      bankAccountCode: 'S11-1201',
      financedAmount: new Prisma.Decimal(8000),
      commission: new Prisma.Decimal(800),
    });
    expect(r.journalEntryId).toBe('existing');
    expect(journal.state.callCount).toBe(0);
  });
});
