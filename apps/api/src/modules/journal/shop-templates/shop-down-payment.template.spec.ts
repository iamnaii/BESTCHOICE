import { Prisma } from '@prisma/client';
import { ShopDownPaymentTemplate } from '../cpa-templates/shop-down-payment.template';
import {
  makeMockJournalAuto,
  makeMockPrisma,
  makeMockCompanyResolver,
  seedExistingJournalEntry,
} from './test-helpers';

/**
 * P3-SP5 (DEEP review C3) — jest unit tests for ShopDownPaymentTemplate.
 *
 * Validates:
 *  - Lines composition (Dr cash / Cr S21-2001) + balance
 *  - Validation guards (downAmount > 0, S-prefix)
 *  - Idempotency probe short-circuits to existing JE
 */
describe('ShopDownPaymentTemplate (unit)', () => {
  function build() {
    const journal = makeMockJournalAuto();
    const prisma = makeMockPrisma();
    const resolver = makeMockCompanyResolver();
    const template = new ShopDownPaymentTemplate(
      journal.service,
      prisma.prisma,
      resolver,
    );
    return { template, journal, prisma, resolver };
  }

  it('posts Dr cash / Cr S21-2001 — balanced', async () => {
    const { template, journal } = build();
    const r = await template.execute({
      idempotencyKey: 'down-1',
      contractId: 'c1',
      cashAccountCode: 'S11-1101',
      downAmount: new Prisma.Decimal(3000),
    });
    expect(r.journalEntryId).toBe('je-1');
    expect(journal.state.lastInput!.companyId).toBe('shop-co-id');
    const lines = journal.state.lastInput!.lines;
    expect(lines).toHaveLength(2);
    const dr = lines.find((l) => l.accountCode === 'S11-1101')!;
    const cr = lines.find((l) => l.accountCode === 'S21-2001')!;
    expect(dr.dr.toFixed(2)).toBe('3000.00');
    expect(cr.cr.toFixed(2)).toBe('3000.00');
  });

  it('throws when downAmount <= 0', async () => {
    const { template } = build();
    await expect(
      template.execute({
        idempotencyKey: 'down-2',
        contractId: 'c1',
        cashAccountCode: 'S11-1101',
        downAmount: new Prisma.Decimal(0),
      }),
    ).rejects.toThrow(/downAmount must be > 0/);
  });

  it('throws when cashAccountCode is FINANCE-side', async () => {
    const { template } = build();
    await expect(
      template.execute({
        idempotencyKey: 'down-3',
        contractId: 'c1',
        cashAccountCode: '11-1101',
        downAmount: new Prisma.Decimal(100),
      }),
    ).rejects.toThrow(/SHOP-side/);
  });

  it('is idempotent — returns existing JE without posting', async () => {
    const { template, journal, prisma } = build();
    seedExistingJournalEntry(prisma.state, 'shop-down-payment', 'down-4', 'existing-id', 'JE-EXISTING');
    const r = await template.execute({
      idempotencyKey: 'down-4',
      contractId: 'c1',
      cashAccountCode: 'S11-1101',
      downAmount: new Prisma.Decimal(100),
    });
    expect(r.journalEntryId).toBe('existing-id');
    expect(r.entryNo).toBe('JE-EXISTING');
    expect(journal.state.callCount).toBe(0);
  });
});
