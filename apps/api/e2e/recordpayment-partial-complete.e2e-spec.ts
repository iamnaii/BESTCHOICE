/**
 * THE HEADLINE — REAL-DB e2e proving PR-843/I2 Phase 3 3a:
 * `PaymentsService.recordPayment` now posts the receipt via the
 * `PaymentReceiptTemplate` primitive (replacing the legacy
 * `PaymentReceipt2BTemplate` in the most-used money path).
 *
 * WHAT THIS PROVES (the blocked-3a footgun is now FIXED)
 * -----------------------------------------------------
 *   - A NON-completing PARTIAL (pay 800 of 1515.83 via case='PARTIAL') →
 *     PARTIALLY_PAID, posts a partial-clear receipt JE.
 *   - COMPLETING the remainder (pay 715.83, NO 'PARTIAL') → SUCCEEDS
 *     (status PAID), NO throw. The primitive reconstructs the prior 800
 *     cleared and clears ONLY the 715.83 remaining delta — the old
 *     delta-vs-cumulative "exceeds tolerance" bug is gone.
 *   - Σ(Cr 11-2103) across BOTH receipt JEs == installmentTotal (every baht
 *     cleared exactly once) and amountPaid ≈ 1515.83.
 *   - A late-fee variant: completing with a real-time late fee books
 *     Cr 42-1103 == lateFee.
 *
 * Mirrors the harness of recordpayment-prior-partial.e2e-spec.ts (real
 * PaymentsService wired to a real DB; HAS_DB skip-gate; SCOPED self-cleanup;
 * audit_logs never deleted).
 *
 * To run locally:
 *   export DATABASE_URL="postgresql://iamnaii@localhost:5432/bestchoice"
 *   cd apps/api && npm run test:e2e -- recordpayment-partial-complete
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { ReceiptsService } from '../src/modules/receipts/receipts.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProductsService } from '../src/modules/products/products.service';
import { JournalAutoService } from '../src/modules/journal/journal-auto.service';
import { PaymentReceipt2BTemplate } from '../src/modules/journal/cpa-templates/payment-receipt-2b.template';
import { PaymentReceiptTemplate } from '../src/modules/journal/cpa-templates/payment-receipt.template';
import { Vat60dayReversalTemplate } from '../src/modules/journal/cpa-templates/vat-60day-reversal.template';
import { BadDebtService } from '../src/modules/accounting/bad-debt.service';
import { BadDebtProvisionTemplate } from '../src/modules/journal/cpa-templates/bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from '../src/modules/journal/cpa-templates/bad-debt-writeoff.template';
import { EclStageReverseTemplate } from '../src/modules/journal/cpa-templates/ecl-stage-reverse.template';
import { ReceiptVoidReversalTemplate } from '../src/modules/journal/cpa-templates/receipt-void-reversal.template';
import { ContractActivation1ATemplate } from '../src/modules/journal/cpa-templates/contract-activation-1a.template';
import { computeInstallmentBreakdown } from '../src/modules/journal/compute-installment-breakdown';
import { seedFinanceCoa } from '../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../src/modules/journal/__tests__/scenario-helpers';

const HAS_DB = !!process.env.DATABASE_URL;
const describeOrSkip = HAS_DB ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;

describeOrSkip('PaymentsService.recordPayment — PARTIAL → COMPLETE via primitive (real DB e2e)', () => {
  let prisma: PrismaService;
  let payments: PaymentsService;

  // ids we created — torn down (scoped) in afterAll.
  const contractIds: string[] = [];
  let adminId: string;
  let createdFinanceCompanyId: string | null = null;

  // installmentTotal for the standard 17K/12M fixture (ROUND_DOWN) = 1515.83.
  let INSTALLMENT_TOTAL: Decimal;
  const PARTIAL_AMOUNT = 800; // first payment — leaves shortage > 1฿ → must use case='PARTIAL'

  const wirePayments = (journal: JournalAutoService): PaymentsService => {
    const receiptVoidReversal = new ReceiptVoidReversalTemplate(journal, prisma as any);
    const paymentReceipt2B = new PaymentReceipt2BTemplate(journal, prisma as any);
    const paymentReceiptTemplate = new PaymentReceiptTemplate(journal, prisma as any);
    const vat60Reversal = new Vat60dayReversalTemplate(journal, prisma as any);
    const receipts = new ReceiptsService(prisma as any, journal, receiptVoidReversal, undefined);
    const audit = new AuditService(prisma as any);
    const products = new ProductsService(prisma as any);
    const badDebt = new BadDebtService(
      prisma as any,
      journal,
      new BadDebtProvisionTemplate(journal, prisma as any),
      new BadDebtWriteOffTemplate(journal, prisma as any),
      new EclStageReverseTemplate(journal, prisma as any),
    );

    // Post-commit side-effect stubs — sendPaymentSuccessLine short-circuits
    // (customer has no lineIdFinance) AND is try/catch-wrapped, so never reached.
    const lineOaStub = { sendFlexMessage: async () => undefined } as any;
    const flexStub = { paymentReceipt: () => ({ quickReply: undefined }) } as any;
    const quickReplyStub = { afterPayment: () => [] } as any;

    return new PaymentsService(
      prisma as any,
      receipts,
      audit,
      journal,
      paymentReceipt2B,
      products,
      lineOaStub,
      flexStub,
      quickReplyStub,
      badDebt,
      // PR-843/I2 Phase 3 3a — REQUIRED primitive + VAT-60-day reversal
      paymentReceiptTemplate,
      vat60Reversal,
      // @Optional() deps — omitted (undefined)
      undefined,
      undefined,
      undefined,
      undefined,
    );
  };

  /** Σ Cr (or Dr) for `accountCode` across ALL receipt JEs of an installment. */
  const sumSide = async (
    instId: string,
    accountCode: string,
    side: 'debit' | 'credit',
  ): Promise<Decimal> => {
    // Mirror PaymentReceiptTemplate.reconstructPrior: tag IN ('receipt','2B')
    // AND metadata.installmentScheduleId == instId.
    const entries = await prisma.journalEntry.findMany({
      where: {
        AND: [
          {
            OR: [
              { metadata: { path: ['tag'], equals: 'receipt' } } as any,
              { metadata: { path: ['tag'], equals: '2B' } } as any,
            ],
          },
          { metadata: { path: ['installmentScheduleId'], equals: instId } } as any,
        ],
      },
      select: { id: true },
    });
    const ids = entries.map((e) => e.id);
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

  /** Build a fresh 17K/12M FINANCE contract + activate it + ensure a PENDING Payment row. */
  const seedContract = async (
    journal: JournalAutoService,
    paymentOverrides: Record<string, unknown> = {},
  ): Promise<{ contractId: string; instId: string }> => {
    const c = await seedStandard17k12m(prisma as any);
    contractIds.push(c.id);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Payment ROW for installment #1 (seed helper creates InstallmentSchedule rows only).
    await prisma.payment.create({
      data: {
        contractId: c.id,
        installmentNo: 1,
        dueDate: new Date(Date.now() + 30 * DAY_MS),
        amountDue: INSTALLMENT_TOTAL.toNumber(),
        amountPaid: 0,
        lateFeeWaived: true,
        status: 'PENDING',
        ...paymentOverrides,
      },
    });
    const inst = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId: c.id, installmentNo: 1 },
    });
    return { contractId: c.id, instId: inst.id };
  };

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
          taxId: '9999999999997',
          companyCode: 'FINANCE',
          address: '1 E2E Rd.',
          directorName: 'E2E Director',
          vatRegistered: true,
          vatRate: '0.0700',
        },
      });
      createdFinanceCompanyId = fin.id;
    }

    const journal = new JournalAutoService(prisma as any);
    payments = wirePayments(journal);

    // Derive installmentTotal via the same ROUND_DOWN basis the template uses
    // (1515.83, NOT the seed's default-rounded 1515.84). seedStandard17k12m is
    // idempotent-safe (creates a fresh contract each call); we only read its
    // fields here, but the contract is tracked + torn down in afterAll.
    const probe = await seedStandard17k12m(prisma as any);
    contractIds.push(probe.id);
    INSTALLMENT_TOTAL = computeInstallmentBreakdown({
      financedAmount: probe.financedAmount.toString(),
      storeCommission: probe.commission != null ? probe.commission.toString() : null,
      interestTotal: probe.interest.toString(),
      vatAmount: probe.vatTotal != null ? probe.vatTotal.toString() : null,
      totalMonths: probe.installmentCount,
    }).installmentTotal;
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    const step = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch {
        /* best-effort teardown — never fail the suite on cleanup */
      }
    };
    try {
      for (const contractId of contractIds) {
        const j1 = await prisma.journalEntry.findMany({
          where: { referenceId: contractId },
          select: { id: true },
        });
        const j2 = await prisma.journalEntry.findMany({
          where: { metadata: { path: ['contractId'], equals: contractId } } as any,
          select: { id: true },
        });
        const ids: string[] = [];
        for (const e of [...j1, ...j2]) if (!ids.includes(e.id)) ids.push(e.id);
        if (ids.length) {
          await step(() => prisma.journalLine.deleteMany({ where: { journalEntryId: { in: ids } } }));
          await step(() => prisma.journalEntry.deleteMany({ where: { id: { in: ids } } }));
        }
        await step(() => prisma.receipt.deleteMany({ where: { contractId } }));
        await step(() => prisma.loyaltyPoint.deleteMany({ where: { contractId } }));
        await step(() =>
          prisma.partialPaymentLink.deleteMany({ where: { payment: { contractId } } }),
        );
        // audit_logs is IMMUTABLE (DB trigger blocks DELETE) — append-only, never deleted.
        await step(() => prisma.payment.deleteMany({ where: { contractId } }));
        await step(() => prisma.installmentSchedule.deleteMany({ where: { contractId } }));
        await step(() => prisma.contract.deleteMany({ where: { id: contractId } }));
      }
      if (createdFinanceCompanyId) {
        await step(() =>
          prisma.companyInfo.deleteMany({ where: { id: createdFinanceCompanyId! } }),
        );
      }
    } finally {
      await prisma.$disconnect();
    }
  }, 120_000);

  it('partial 800 → complete 715.83 SUCCEEDS (PAID, no throw); Σ(Cr 11-2103) == installmentTotal', async () => {
    const journal = new JournalAutoService(prisma as any);
    const { contractId, instId } = await seedContract(journal);

    // STEP 1 — NON-completing PARTIAL (pay 800) → PARTIALLY_PAID.
    const partial = await payments.recordPayment(
      contractId,
      1,
      PARTIAL_AMOUNT,
      'BANK_TRANSFER',
      adminId,
      'https://example.test/slip-partial.jpg',
      undefined,
      'e2e-partial-complete-step1',
      '11-1101',
      undefined,
      'PARTIAL',
    );
    expect(partial.status).toBe('PARTIALLY_PAID');
    expect(Number(partial.amountPaid)).toBeCloseTo(PARTIAL_AMOUNT, 2);

    // STEP 2 — COMPLETE the remainder (715.83), NOT 'PARTIAL'. Must SUCCEED.
    const remaining = Math.round((INSTALLMENT_TOTAL.toNumber() - PARTIAL_AMOUNT) * 100) / 100; // 715.83
    const complete = await payments.recordPayment(
      contractId,
      1,
      remaining,
      'BANK_TRANSFER',
      adminId,
      'https://example.test/slip-complete.jpg',
      undefined,
      'e2e-partial-complete-step2',
      '11-1101',
      undefined,
      undefined, // NOT 'PARTIAL' — completing receipt
    );
    expect(complete.status).toBe('PAID');
    expect(Number(complete.amountPaid)).toBeCloseTo(INSTALLMENT_TOTAL.toNumber(), 2);

    // Σ Cr 11-2103 across BOTH receipt JEs == installmentTotal (every baht cleared once).
    expect((await sumSide(instId, '11-2103', 'credit')).toFixed(2)).toBe(
      INSTALLMENT_TOTAL.toFixed(2),
    );

    // Two distinct receipt JEs were posted (partial then completion — not consolidated,
    // not colliding on reference — PR 3.1 reference=randomUUID).
    const entries = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: 'receipt' } } as any,
          { metadata: { path: ['installmentScheduleId'], equals: instId } } as any,
        ],
      },
      select: { id: true },
    });
    expect(entries.length).toBe(2);
  }, 180_000);

  it('completing with a real-time late fee books Cr 42-1103 == lateFee', async () => {
    const LATE_FEE = 100;
    const journal = new JournalAutoService(prisma as any);

    // Seed a contract whose installment #1 carries a pre-stored late fee. recordPayment
    // reads payment.lateFee at payment time and forwards it to the primitive (Cr 42-1103).
    // lateFeeWaived=true so the real-time recompute does NOT overwrite our fixed value,
    // keeping the assertion deterministic.
    const { contractId, instId } = await seedContract(journal, {
      lateFee: LATE_FEE,
      lateFeeWaived: true,
    });

    // Pay installmentTotal + lateFee in one completing receipt → PAID, Cr 42-1103 == 100.
    const payAmount =
      Math.round((INSTALLMENT_TOTAL.toNumber() + LATE_FEE) * 100) / 100;
    const res = await payments.recordPayment(
      contractId,
      1,
      payAmount,
      'BANK_TRANSFER',
      adminId,
      'https://example.test/slip-latefee.jpg',
      undefined,
      'e2e-partial-complete-latefee',
      '11-1101',
      undefined,
      undefined,
    );
    expect(res.status).toBe('PAID');

    expect((await sumSide(instId, '11-2103', 'credit')).toFixed(2)).toBe(
      INSTALLMENT_TOTAL.toFixed(2),
    );
    expect((await sumSide(instId, '42-1103', 'credit')).toFixed(2)).toBe(LATE_FEE.toFixed(2));
  }, 180_000);
});
