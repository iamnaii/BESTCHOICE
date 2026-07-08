/**
 * Phase 2 / P2-7 golden — gross late-fee waiver posts Dr 52-1105 + Cr 42-1103 GROSS.
 *
 * Runner: vitest (DB-backed; *.integration.spec.ts is jest-ignored per package.json).
 * Run:    cd apps/api && npx vitest run --no-file-parallelism \
 *           src/modules/journal/cpa-templates/payment-receipt.waiver.integration.spec.ts
 *
 * The pure math is covered DB-free by build-receipt-lines.spec.ts +
 * payments.service.advance.spec.ts (mocked recordPayment). This asserts the REAL
 * posted JE rows for the mockup golden:
 *   Dr 11-1201 1,456.66 + Dr 21-1103 84.17 + Dr 52-1105 25.00
 *     / Cr 11-2103 1,515.83 + Cr 42-1103 50.00   (balanced 1,565.83)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { JournalAutoService } from '../journal-auto.service';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from './installment-accrual-2a.template';
import { PaymentReceiptTemplate } from './payment-receipt.template';

const prisma = new PrismaClient();
const D = (n: string) => new Decimal(n);

async function ensureFinanceCompany(): Promise<void> {
  const existing = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
  if (!existing) {
    await prisma.companyInfo.create({
      data: {
        nameTh: 'BESTCHOICE FINANCE',
        taxId: '0000000000002',
        companyCode: 'FINANCE',
        address: '1 Finance Rd.',
        directorName: 'Test Director',
        vatRegistered: true,
        vatRate: new Decimal('0.0700'),
      },
    });
  }
}

describe('payment-receipt gross waiver (integration)', () => {
  let scheduleId: string;

  beforeAll(async () => {
    // JournalPostAuditLog rows (asset flows) FK-reference journal_entries — clear
    // them first or this deleteMany trips P2003 when an asset spec ran earlier.
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});

    await seedFinanceCoa(prisma);
    await ensureFinanceCompany();

    const journal = new JournalAutoService(prisma as any);
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const sched = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId: c.id, installmentNo: 5 } },
    });
    await new InstallmentAccrual2ATemplate(journal, prisma as any).execute(sched.id);
    scheduleId = sched.id;
  });

  afterAll(async () => {
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await prisma.$disconnect();
  });

  it('books Dr 52-1105 = waived + Cr 42-1103 = GROSS, balanced at 1,565.83', async () => {
    const journal = new JournalAutoService(prisma as any);
    const tpl = new PaymentReceiptTemplate(journal, prisma as any);

    await tpl.execute({
      installmentScheduleId: scheduleId,
      delta: D('1456.66'),
      debitAccountCode: '11-1201',
      advanceConsume: D('84.17'),
      lateFee: D('50'), // gross
      lateFeeWaived: D('25'),
      isFinalReceipt: true,
    });

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: 'receipt' } } as any,
          { metadata: { path: ['installmentScheduleId'], equals: scheduleId } } as any,
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });
    expect(je, 'expected a receipt JE').not.toBeNull();

    const line = (code: string) => je!.lines.find((l) => l.accountCode === code);
    const dr = (code: string) => new Decimal(line(code)!.debit.toString()).toFixed(2);
    const cr = (code: string) => new Decimal(line(code)!.credit.toString()).toFixed(2);

    expect(dr('11-1201')).toBe('1456.66');
    expect(dr('21-1103')).toBe('84.17');
    expect(dr('52-1105')).toBe('25.00'); // waiver discount
    expect(cr('11-2103')).toBe('1515.83');

    // Cr 42-1103 is a SINGLE line at the GROSS amount (net 25 + waived 25 = 50)
    const cr42 = je!.lines.filter((l) => l.accountCode === '42-1103');
    expect(cr42).toHaveLength(1);
    expect(new Decimal(cr42[0].credit.toString()).toFixed(2)).toBe('50.00');

    const totalDr = je!.lines.reduce((s, l) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
    const totalCr = je!.lines.reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe('1565.83');
    expect(totalCr.toFixed(2)).toBe('1565.83');
  });
});
