import { Prisma } from '@prisma/client';
import { ShopExpenseTemplate } from '../cpa-templates/shop-expense.template';
import {
  makeMockJournalAuto,
  makeMockPrisma,
  makeMockCompanyResolver,
  seedExistingJournalEntry,
} from './test-helpers';

describe('ShopExpenseTemplate (unit)', () => {
  function build() {
    const journal = makeMockJournalAuto();
    const prisma = makeMockPrisma();
    const resolver = makeMockCompanyResolver();
    const template = new ShopExpenseTemplate(
      journal.service,
      prisma.prisma,
      resolver,
    );
    return { template, journal, prisma, resolver };
  }

  it('CASH mode posts Dr expense / Cr cash — balanced', async () => {
    const { template, journal } = build();
    await template.execute({
      idempotencyKey: 'ex-1',
      expenseId: 'ex-001',
      expenseAccountCode: 'S51-1101',
      amount: new Prisma.Decimal(8000),
      mode: 'CASH',
      cashAccountCode: 'S11-1201',
    });
    const lines = journal.state.lastInput!.lines;
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.accountCode === 'S51-1101')!.dr.toFixed(2)).toBe('8000.00');
    expect(lines.find((l) => l.accountCode === 'S11-1201')!.cr.toFixed(2)).toBe('8000.00');
  });

  it('ACCRUAL mode defaults Cr to S21-1103', async () => {
    const { template, journal } = build();
    await template.execute({
      idempotencyKey: 'ex-2',
      expenseId: 'ex-002',
      expenseAccountCode: 'S52-1101',
      amount: new Prisma.Decimal(4500),
      mode: 'ACCRUAL',
    });
    const lines = journal.state.lastInput!.lines;
    expect(lines.find((l) => l.accountCode === 'S21-1103')!.cr.toFixed(2)).toBe('4500.00');
  });

  it('ACCRUAL accepts payableAccountCode override', async () => {
    const { template, journal } = build();
    await template.execute({
      idempotencyKey: 'ex-3',
      expenseId: 'ex-003',
      expenseAccountCode: 'S52-1101',
      amount: new Prisma.Decimal(500),
      mode: 'ACCRUAL',
      payableAccountCode: 'S21-1102',
    });
    const lines = journal.state.lastInput!.lines;
    expect(lines.find((l) => l.accountCode === 'S21-1102')!.cr.toFixed(2)).toBe('500.00');
  });

  it('CASH mode without cashAccountCode is rejected', async () => {
    const { template } = build();
    await expect(
      template.execute({
        idempotencyKey: 'ex-4',
        expenseId: 'ex-004',
        expenseAccountCode: 'S51-1101',
        amount: new Prisma.Decimal(100),
        mode: 'CASH',
      }),
    ).rejects.toThrow(/cashAccountCode required/);
  });

  it('rejects non-SHOP expenseAccountCode', async () => {
    const { template } = build();
    await expect(
      template.execute({
        idempotencyKey: 'ex-5',
        expenseId: 'ex-005',
        expenseAccountCode: '53-1101',
        amount: new Prisma.Decimal(100),
        mode: 'ACCRUAL',
      }),
    ).rejects.toThrow(/SHOP-side/);
  });

  it('is idempotent', async () => {
    const { template, prisma, journal } = build();
    seedExistingJournalEntry(prisma.state, 'shop-expense', 'ex-6', 'existing', 'JE-X');
    const r = await template.execute({
      idempotencyKey: 'ex-6',
      expenseId: 'ex-006',
      expenseAccountCode: 'S51-1101',
      amount: new Prisma.Decimal(100),
      mode: 'ACCRUAL',
    });
    expect(r.journalEntryId).toBe('existing');
    expect(journal.state.callCount).toBe(0);
  });
});
