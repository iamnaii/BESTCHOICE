/**
 * REAL-DB e2e for the PaymentReceiptTemplate primitive (PR-843 / I2 Phase 2).
 * Proves Σ(Cr 11-2103) per installment == installmentTotal and Σ(Cr 42-1103) ==
 * lateFee across ANY receipt sequence, with NO template mocking. Harness mirrors
 * recordpayment-prior-partial.e2e-spec.ts (HAS_DB gate, scoped cleanup).
 *
 * Run:
 *   export DATABASE_URL="postgresql://iamnaii@localhost:5432/bestchoice"
 *   cd apps/api && npm run test:e2e -- payment-receipt-primitive
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../src/prisma/prisma.service';
import { JournalAutoService } from '../src/modules/journal/journal-auto.service';
import { PaymentReceiptTemplate } from '../src/modules/journal/cpa-templates/payment-receipt.template';
import { ContractActivation1ATemplate } from '../src/modules/journal/cpa-templates/contract-activation-1a.template';
import { computeInstallmentBreakdown } from '../src/modules/journal/compute-installment-breakdown';
import { seedFinanceCoa } from '../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../src/modules/journal/__tests__/scenario-helpers';

const HAS_DB = !!process.env.DATABASE_URL;
const describeOrSkip = HAS_DB ? describe : describe.skip;

describeOrSkip('PaymentReceiptTemplate primitive — Σ-invariants (real DB e2e)', () => {
  let prisma: PrismaService;
  let template: PaymentReceiptTemplate;
  let contractId: string;
  let instId: string;
  let installmentTotal: Decimal;
  let adminId: string;
  let createdFinanceCompanyId: string | null = null;

  const useInstallment = async (installmentNo: number) => {
    const inst = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId, installmentNo },
    });
    instId = inst.id;
  };

  const entryIdsForInstallment = async (): Promise<string[]> => {
    const entries = await prisma.journalEntry.findMany({
      where: { metadata: { path: ['installmentScheduleId'], equals: instId } as any },
      select: { id: true },
    });
    return entries.map((e) => e.id);
  };

  const sumSide = async (accountCode: string, side: 'debit' | 'credit'): Promise<Decimal> => {
    const ids = await entryIdsForInstallment();
    if (ids.length === 0) return new Decimal(0);
    const lines = await prisma.journalLine.findMany({
      where: { journalEntryId: { in: ids }, accountCode },
      select: { debit: true, credit: true },
    });
    return lines.reduce(
      (a, l) => a.plus(new Decimal((side === 'debit' ? l.debit : l.credit).toString())),
      new Decimal(0),
    );
  };
  const sumCredits = (code: string) => sumSide(code, 'credit');
  const sumDebits = (code: string) => sumSide(code, 'debit');

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await seedFinanceCoa(prisma as any);
    const admin = await prisma.user.upsert({
      where: { email: 'admin@bestchoice.com' },
      create: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      update: {},
    });
    adminId = admin.id;

    const existingFin = await prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!existingFin) {
      const fin = await prisma.companyInfo.create({
        data: {
          nameTh: 'E2E Finance Co.',
          taxId: '9999999999998',
          companyCode: 'FINANCE',
          address: '1 E2E Rd.',
          directorName: 'E2E Director',
          vatRegistered: true,
          vatRate: '0.0700',
        },
      });
      createdFinanceCompanyId = fin.id;
    }

    // seedStandard17k12m returns StandardContract: { id, financedAmount, commission,
    // interest, vatTotal, installmentCount, installmentTotal, startDate }
    const c = await seedStandard17k12m(prisma as any);
    contractId = c.id;
    const journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // computeInstallmentBreakdown expects storeCommission/interestTotal/vatAmount/totalMonths
    // but StandardContract exposes commission/interest/vatTotal/installmentCount — map them.
    installmentTotal = computeInstallmentBreakdown({
      financedAmount: c.financedAmount.toString(),
      storeCommission: c.commission != null ? c.commission.toString() : null,
      interestTotal: c.interest.toString(),
      vatAmount: c.vatTotal != null ? c.vatTotal.toString() : null,
      totalMonths: c.installmentCount,
    }).installmentTotal;

    template = new PaymentReceiptTemplate(journal, prisma as any);
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    const step = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch {
        /* best-effort teardown */
      }
    };
    try {
      if (!contractId) return;
      const jes = await prisma.journalEntry.findMany({
        where: {
          OR: [
            { referenceId: contractId },
            { metadata: { path: ['contractId'], equals: contractId } as any },
          ],
        },
        select: { id: true },
      });
      const ids = jes.map((e) => e.id);
      if (ids.length) {
        await step(() => prisma.journalLine.deleteMany({ where: { journalEntryId: { in: ids } } }));
        await step(() => prisma.journalEntry.deleteMany({ where: { id: { in: ids } } }));
      }
      // audit_logs is IMMUTABLE — never deleted.
      await step(() => prisma.payment.deleteMany({ where: { contractId } }));
      await step(() => prisma.installmentSchedule.deleteMany({ where: { contractId } }));
      await step(() => prisma.contract.deleteMany({ where: { id: contractId } }));
      if (createdFinanceCompanyId) {
        await step(() => prisma.companyInfo.deleteMany({ where: { id: createdFinanceCompanyId! } }));
      }
    } finally {
      await prisma.$disconnect();
    }
  }, 120_000);

  it('partial → partial → completion: Σ(Cr 11-2103) == installmentTotal, every receipt ledgered', async () => {
    await useInstallment(1);
    const remainder = installmentTotal.minus(500).minus(600); // 3rd receipt closes it
    await template.execute({ installmentScheduleId: instId, delta: new Decimal('500'), debitAccountCode: '11-1101' });
    await template.execute({ installmentScheduleId: instId, delta: new Decimal('600'), debitAccountCode: '11-1101' });
    const third = await template.execute({
      installmentScheduleId: instId,
      delta: remainder,
      debitAccountCode: '11-1101',
      isFinalReceipt: true,
    });

    const jeCount = (await entryIdsForInstallment()).length;
    expect(jeCount).toBe(3); // no completion re-clears the whole installment

    expect((await sumCredits('11-2103')).toFixed(2)).toBe(installmentTotal.toFixed(2));
    expect(third.split.principalRemainingAfter.toFixed(2)).toBe('0.00');
  }, 120_000);

  it('late fee: delta = installmentTotal + 100 books Cr 42-1103 == 100, no throw', async () => {
    await useInstallment(2);
    await template.execute({
      installmentScheduleId: instId,
      delta: installmentTotal.plus(100),
      lateFee: new Decimal('100'),
      debitAccountCode: '11-1101',
      isFinalReceipt: true,
    });
    expect((await sumCredits('11-2103')).toFixed(2)).toBe(installmentTotal.toFixed(2));
    expect((await sumCredits('42-1103')).toFixed(2)).toBe('100.00');
  }, 120_000);

  it('over-collection beyond tolerance with no advanceCredit → rejects (surplus never silently dropped)', async () => {
    await useInstallment(3);
    await expect(
      template.execute({
        installmentScheduleId: instId,
        delta: installmentTotal.plus(50),
        debitAccountCode: '11-1101',
        isFinalReceipt: true,
      }),
    ).rejects.toThrow(/exceeds tolerance 1\.00/i);
  }, 120_000);

  it('over-collection parked as advanceCredit → Cr 21-1103 == surplus, clean clear', async () => {
    await useInstallment(4);
    await template.execute({
      installmentScheduleId: instId,
      delta: installmentTotal.plus(50),
      advanceCredit: new Decimal('50'),
      debitAccountCode: '11-1101',
      isFinalReceipt: true,
    });
    expect((await sumCredits('11-2103')).toFixed(2)).toBe(installmentTotal.toFixed(2));
    expect((await sumCredits('21-1103')).toFixed(2)).toBe('50.00');
  }, 120_000);

  it('final underpay 0.01 with approver → Dr 52-1104 == 0.01, installment fully cleared', async () => {
    await useInstallment(5);
    await template.execute({
      installmentScheduleId: instId,
      delta: installmentTotal.minus(new Decimal('0.01')),
      debitAccountCode: '11-1101',
      isFinalReceipt: true,
      toleranceApproverId: adminId,
    });
    expect((await sumCredits('11-2103')).toFixed(2)).toBe(installmentTotal.toFixed(2));
    expect((await sumDebits('52-1104')).toFixed(2)).toBe('0.01');
  }, 120_000);

  it('precondition: advanceCredit > delta + advanceConsume → rejects (review I-1 guard)', async () => {
    await useInstallment(6);
    await expect(
      template.execute({
        installmentScheduleId: instId,
        delta: new Decimal('100'),
        advanceCredit: new Decimal('200'),
        debitAccountCode: '11-1101',
      }),
    ).rejects.toThrow(/exceeds available funds/i);
  }, 120_000);
});
