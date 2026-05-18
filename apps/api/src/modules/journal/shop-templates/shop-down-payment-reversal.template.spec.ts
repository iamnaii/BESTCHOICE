import { Prisma } from '@prisma/client';
import { ShopDownPaymentReversalTemplate } from '../cpa-templates/shop-down-payment-reversal.template';
import {
  makeMockJournalAuto,
  makeMockPrisma,
  makeMockCompanyResolver,
  seedExistingJournalEntry,
} from './test-helpers';

/**
 * P3-SP5 W2 — jest unit tests for ShopDownPaymentReversalTemplate
 * (cancel a contract before activation → refund the customer's down).
 */
describe('ShopDownPaymentReversalTemplate (unit)', () => {
  function build() {
    const journal = makeMockJournalAuto();
    const prisma = makeMockPrisma();
    const resolver = makeMockCompanyResolver();
    const template = new ShopDownPaymentReversalTemplate(
      journal.service,
      prisma.prisma,
      resolver,
    );
    return { template, journal, prisma, resolver };
  }

  it('posts Dr S21-2001 / Cr cash for the refund amount — balanced', async () => {
    const { template, journal } = build();
    const r = await template.execute({
      idempotencyKey: 'down-rev-1',
      contractId: 'c1',
      refundAccountCode: 'S11-1101',
      downAmount: new Prisma.Decimal(3000),
    });
    expect(r.journalEntryId).toBe('je-1');
    const lines = journal.state.lastInput!.lines;
    const dr = lines.find((l) => l.accountCode === 'S21-2001')!;
    const cr = lines.find((l) => l.accountCode === 'S11-1101')!;
    expect(dr.dr.toFixed(2)).toBe('3000.00');
    expect(cr.cr.toFixed(2)).toBe('3000.00');
  });

  it('throws when downAmount <= 0', async () => {
    const { template } = build();
    await expect(
      template.execute({
        idempotencyKey: 'down-rev-2',
        contractId: 'c1',
        refundAccountCode: 'S11-1101',
        downAmount: new Prisma.Decimal(0),
      }),
    ).rejects.toThrow(/downAmount must be > 0/);
  });

  it('throws when refundAccountCode is FINANCE-side', async () => {
    const { template } = build();
    await expect(
      template.execute({
        idempotencyKey: 'down-rev-3',
        contractId: 'c1',
        refundAccountCode: '11-1101',
        downAmount: new Prisma.Decimal(100),
      }),
    ).rejects.toThrow(/SHOP-side/);
  });

  it('is idempotent — short-circuits on repeated key', async () => {
    const { template, journal, prisma } = build();
    seedExistingJournalEntry(prisma.state, 'shop-down-payment-reversal', 'down-rev-4', 'existing', 'JE-EXISTING');
    const r = await template.execute({
      idempotencyKey: 'down-rev-4',
      contractId: 'c1',
      refundAccountCode: 'S11-1101',
      downAmount: new Prisma.Decimal(100),
    });
    expect(r.journalEntryId).toBe('existing');
    expect(journal.state.callCount).toBe(0);
  });
});
