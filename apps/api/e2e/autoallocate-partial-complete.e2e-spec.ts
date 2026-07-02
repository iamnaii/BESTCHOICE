/**
 * THE HEADLINE — REAL-DB e2e proving PR-843/I2 Phase 3 3c:
 * `PaymentsService.autoAllocatePayment` (the bulk-allocation money path) now
 * posts the receipt via the `PaymentReceiptTemplate` primitive on EVERY
 * iteration (partial AND full), replacing the legacy
 * `PaymentReceipt2BTemplate` which only posted on full payment with a
 * CUMULATIVE amountReceived.
 *
 * WHAT THIS PROVES
 * ----------------
 *   - A lump sum that PARTIALLY pays one installment now LEDGERS the partial
 *     (defect 2 fixed) with isFinalReceipt=false → one partial receipt JE.
 *   - A second autoAllocate that COMPLETES the installment posts a second
 *     receipt JE clearing ONLY the remaining delta (delta-not-cumulative).
 *   - Σ(Cr 11-2103) for the installment across BOTH receipt JEs ==
 *     installmentTotal (every baht cleared exactly once — no double-count).
 *   - A one-shot full allocation posts a single final receipt JE clearing the
 *     full installmentTotal.
 *   - Overpayment beyond all unpaid installments still lands on
 *     contract.creditBalance (unchanged) with its own overpayment-credit JE.
 *
 * SEAM EXCLUSION (documented, NOT introduced here): this suite ONLY touches
 * NON-LAST installments whose amountDue == installmentTotal. A completing
 * receipt on the LAST installment where amountDue < installmentTotal (the 2A
 * trueup residual) would need toleranceApproverId — which autoAllocate does
 * not pass — and would throw. That is a pre-existing epic-wide seam resolved
 * once in Phase 5; see the PR-843/I2 Phase 3 3c brief.
 *
 * Mirrors the harness of recordpayment-partial-complete.e2e-spec.ts (real
 * PaymentsService wired to a real DB; HAS_DB skip-gate; SCOPED self-cleanup;
 * audit_logs never deleted).
 *
 * To run locally:
 *   export DATABASE_URL="postgresql://iamnaii@localhost:5432/bestchoice"
 *   cd apps/api && npm run test:e2e -- autoallocate
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { ReceiptsService } from '../src/modules/receipts/receipts.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProductsService } from '../src/modules/products/products.service';
import { JournalAutoService } from '../src/modules/journal/journal-auto.service';
import { PaymentReceiptTemplate } from '../src/modules/journal/cpa-templates/payment-receipt.template';
import { Vat60dayReversalTemplate } from '../src/modules/journal/cpa-templates/vat-60day-reversal.template';
import { BadDebtService } from '../src/modules/accounting/bad-debt.service';
import { BadDebtProvisionTemplate } from '../src/modules/journal/cpa-templates/bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from '../src/modules/journal/cpa-templates/bad-debt-writeoff.template';
import { EclStageReverseTemplate } from '../src/modules/journal/cpa-templates/ecl-stage-reverse.template';
import { ConsecutiveMissedService } from '../src/modules/overdue/consecutive-missed.service';
import { ReceiptVoidReversalTemplate } from '../src/modules/journal/cpa-templates/receipt-void-reversal.template';
import { ContractActivation1ATemplate } from '../src/modules/journal/cpa-templates/contract-activation-1a.template';
import { computeInstallmentBreakdown } from '../src/modules/journal/compute-installment-breakdown';
import { seedFinanceCoa } from '../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../src/modules/journal/__tests__/scenario-helpers';

const HAS_DB = !!process.env.DATABASE_URL;
const describeOrSkip = HAS_DB ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;

describeOrSkip('PaymentsService.autoAllocatePayment — PARTIAL → COMPLETE via primitive (real DB e2e)', () => {
  let prisma: PrismaService;
  let payments: PaymentsService;

  // ids we created — torn down (scoped) in afterAll.
  const contractIds: string[] = [];
  let adminId: string;
  let createdFinanceCompanyId: string | null = null;

  // installmentTotal for the standard 17K/12M fixture (ROUND_DOWN) = 1515.83.
  let INSTALLMENT_TOTAL: Decimal;
  const PARTIAL_AMOUNT = 800; // first lump — leaves a shortage > 1฿ (non-completing partial)

  const wirePayments = (journal: JournalAutoService): PaymentsService => {
    const receiptVoidReversal = new ReceiptVoidReversalTemplate(journal, prisma as any);
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
      new ConsecutiveMissedService(prisma as any),
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
      products,
      lineOaStub,
      flexStub,
      quickReplyStub,
      badDebt,
      // PR-843/I2 Phase 3 3a/3c — REQUIRED primitive + VAT-60-day reversal
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

  /** Count distinct receipt JEs (tag='receipt') posted for an installment. */
  const countReceiptEntries = async (instId: string): Promise<number> => {
    const entries = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: 'receipt' } } as any,
          { metadata: { path: ['installmentScheduleId'], equals: instId } } as any,
        ],
      },
      select: { id: true },
    });
    return entries.length;
  };

  /**
   * Build a fresh 17K/12M FINANCE contract + activate it + create a PENDING
   * Payment row for `installmentNo` (NON-LAST — default #1 — to avoid the 2A
   * trueup-residual seam). amountDue == installmentTotal so a completing
   * receipt never underpays.
   */
  const seedContract = async (
    journal: JournalAutoService,
    installmentNo = 1,
  ): Promise<{ contractId: string; instId: string }> => {
    const c = await seedStandard17k12m(prisma as any);
    contractIds.push(c.id);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    await prisma.payment.create({
      data: {
        contractId: c.id,
        installmentNo,
        dueDate: new Date(Date.now() + 30 * DAY_MS),
        amountDue: INSTALLMENT_TOTAL.toNumber(),
        amountPaid: 0,
        lateFeeWaived: true, // deterministic — no real-time fee recompute
        status: 'PENDING',
      },
    });
    const inst = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId: c.id, installmentNo },
    });
    return { contractId: c.id, instId: inst.id };
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    await seedFinanceCoa(prisma as any);

    // 21-5101 (เงินเกินของลูกค้า / Customer Credit Balance) is the Cr leg of the
    // autoAllocate overpayment-credit JE. It is a real production account but is
    // NOT in the 99-account CPA test fixture seeded by seedFinanceCoa, so the
    // overpay case below would otherwise throw "Account code not found in CoA".
    // Upserted idempotently (left in place like the rest of the seeded CoA).
    await prisma.chartOfAccount.upsert({
      where: { code: '21-5101' },
      create: {
        code: '21-5101',
        name: 'เงินเกินของลูกค้า (Customer Credit Balance)',
        type: 'หนี้สิน',
        normalBalance: 'Cr',
        category: 'หนี้สิน',
      },
      update: { deletedAt: null },
    });

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
    // (1515.83). seedStandard17k12m creates a fresh contract each call; we read
    // its fields here but the contract is tracked + torn down in afterAll.
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

  it('partial lump (800) ledgers a partial receipt; completing lump clears the remainder; Σ(Cr 11-2103) == installmentTotal (no double-count)', async () => {
    const journal = new JournalAutoService(prisma as any);
    const { contractId, instId } = await seedContract(journal);

    // STEP 1 — lump of 800 PARTIALLY pays installment #1 → PARTIALLY_PAID.
    const partial = await payments.autoAllocatePayment(
      contractId,
      PARTIAL_AMOUNT,
      'BANK_TRANSFER',
      adminId,
      'auto-allocate partial',
      'https://example.test/slip-auto-partial.jpg',
    );
    expect(partial.allocatedPayments).toHaveLength(1);
    expect(partial.allocatedPayments[0].status).toBe('PARTIALLY_PAID');
    expect(Number(partial.allocatedPayments[0].amountPaid)).toBeCloseTo(PARTIAL_AMOUNT, 2);
    expect(partial.overpayment).toBe(0);

    // The partial is NOW ledgered (defect 2 fixed) — one receipt JE so far.
    expect(await countReceiptEntries(instId)).toBe(1);

    // STEP 2 — second lump completes the remainder (installmentTotal - 800).
    const remaining = Math.round((INSTALLMENT_TOTAL.toNumber() - PARTIAL_AMOUNT) * 100) / 100;
    const complete = await payments.autoAllocatePayment(
      contractId,
      remaining,
      'BANK_TRANSFER',
      adminId,
      'auto-allocate complete',
    );
    expect(complete.allocatedPayments).toHaveLength(1);
    expect(complete.allocatedPayments[0].status).toBe('PAID');
    expect(Number(complete.allocatedPayments[0].amountPaid)).toBeCloseTo(
      INSTALLMENT_TOTAL.toNumber(),
      2,
    );
    expect(complete.overpayment).toBe(0);

    // Two distinct receipt JEs (partial then completion) — PR 3.1 unique reference.
    expect(await countReceiptEntries(instId)).toBe(2);

    // THE INVARIANT — Σ Cr 11-2103 across BOTH receipt JEs == installmentTotal.
    // (delta-not-cumulative: the completion cleared ONLY the remaining delta,
    // not the full installmentTotal a second time.)
    expect((await sumSide(instId, '11-2103', 'credit')).toFixed(2)).toBe(
      INSTALLMENT_TOTAL.toFixed(2),
    );
  }, 180_000);

  it('one-shot full allocation posts a single final receipt JE clearing the full installmentTotal', async () => {
    const journal = new JournalAutoService(prisma as any);
    const { contractId, instId } = await seedContract(journal);

    const res = await payments.autoAllocatePayment(
      contractId,
      INSTALLMENT_TOTAL.toNumber(),
      'CASH',
      adminId,
    );
    expect(res.allocatedPayments).toHaveLength(1);
    expect(res.allocatedPayments[0].status).toBe('PAID');
    expect(res.overpayment).toBe(0);

    expect(await countReceiptEntries(instId)).toBe(1);
    expect((await sumSide(instId, '11-2103', 'credit')).toFixed(2)).toBe(
      INSTALLMENT_TOTAL.toFixed(2),
    );
  }, 180_000);

  it('overpayment beyond the only unpaid installment lands on contract.creditBalance (unchanged)', async () => {
    const journal = new JournalAutoService(prisma as any);
    const { contractId, instId } = await seedContract(journal);

    const OVER = 500; // surplus beyond installmentTotal
    const res = await payments.autoAllocatePayment(
      contractId,
      INSTALLMENT_TOTAL.toNumber() + OVER,
      'CASH',
      adminId,
    );
    expect(res.allocatedPayments).toHaveLength(1);
    expect(res.allocatedPayments[0].status).toBe('PAID');
    expect(res.overpayment).toBeCloseTo(OVER, 2);

    // The installment is cleared exactly once (the surplus did NOT inflate 11-2103).
    expect((await sumSide(instId, '11-2103', 'credit')).toFixed(2)).toBe(
      INSTALLMENT_TOTAL.toFixed(2),
    );

    // The surplus is parked on the contract creditBalance.
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(Number(contract.creditBalance)).toBeCloseTo(OVER, 2);

    // And a distinct overpayment-credit JE was posted (Dr cash / Cr 21-5101).
    const overpayJe = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['tag'], equals: 'overpayment-credit' } } as any,
      select: { id: true },
    });
    expect(overpayJe).not.toBeNull();
  }, 180_000);
});
