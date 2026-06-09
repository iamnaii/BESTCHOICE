/**
 * THE HEADLINE — REAL-DB e2e proving PR-843/I2 Phase 3 3d:
 * `PaymentsService.applyCreditBalance` (the credit-balance allocation money
 * path) now posts the credit-application JE via the `PaymentReceiptTemplate`
 * primitive (Dr 21-5101 customer-credit / Cr 11-2103 receivable, delta-clear),
 * MOVED OUTSIDE the isPaidInFull guard so PARTIAL credit applications are now
 * LEDGERED too — replacing the custom inline JE that posted ONLY on full
 * payment, ignored the lateFee split, and used tag:'credit-allocation'.
 *
 * WHAT THIS PROVES
 * ----------------
 *   (a) A credit application that COMPLETES an installment that had a PRIOR 800
 *       partial (posted as a real receipt) clears ONLY the remaining delta:
 *         - the credit JE carries tag:'receipt' + metadata.installmentScheduleId
 *           + metadata.paymentId (NOT tag:'credit-allocation'),
 *         - Σ(Cr 11-2103) for the installment across BOTH receipts ==
 *           installmentTotal (the credit cleared the delta, NOT double),
 *         - the credit JE debits 21-5101 (customer credit), NOT cash.
 *   (b) A PARTIAL credit application (credit < amountDue) is now LEDGERED —
 *       a receipt JE exists with isFinalReceipt=false (the installment stays
 *       PARTIALLY_PAID). This is the defect-2 fix carried to the credit path.
 *   (c) A late-fee variant: the credit-funded late fee now books as Cr 42-1103
 *       income (was implicitly lumped into the Cr 11-2103 clear). Σ(Cr 42-1103)
 *       == lateFee and Σ(Dr 21-5101) == payAmount (the Dr total is unchanged).
 *       [ACCOUNTANT SIGN-OFF NOTE — behaviour change, see the 3d brief.]
 *
 * SEAM EXCLUSION (documented, NOT introduced here): this suite ONLY touches
 * NON-LAST installments whose amountDue == installmentTotal, avoiding the
 * documented last-installment amountDue<installmentTotal 2A-trueup-residual seam
 * (a completing receipt there would need a toleranceApproverId, which the credit
 * path does not pass). Resolved once epic-wide in Phase 5.
 *
 * Mirrors the harness of autoallocate-partial-complete.e2e-spec.ts (real
 * PaymentsService wired to a real DB; HAS_DB skip-gate; SCOPED self-cleanup;
 * audit_logs never deleted).
 *
 * To run locally:
 *   export DATABASE_URL="postgresql://iamnaii@localhost:5432/bestchoice"
 *   cd apps/api && npm run test:e2e -- applycreditbalance
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
import { ReceiptVoidReversalTemplate } from '../src/modules/journal/cpa-templates/receipt-void-reversal.template';
import { ContractActivation1ATemplate } from '../src/modules/journal/cpa-templates/contract-activation-1a.template';
import { computeInstallmentBreakdown } from '../src/modules/journal/compute-installment-breakdown';
import { seedFinanceCoa } from '../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../src/modules/journal/__tests__/scenario-helpers';

const HAS_DB = !!process.env.DATABASE_URL;
const describeOrSkip = HAS_DB ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;

describeOrSkip('PaymentsService.applyCreditBalance — credit delta-clear via primitive (real DB e2e)', () => {
  let prisma: PrismaService;
  let payments: PaymentsService;

  // ids we created — torn down (scoped) in afterAll.
  const contractIds: string[] = [];
  let adminId: string;
  let createdFinanceCompanyId: string | null = null;

  // installmentTotal for the standard 17K/12M fixture (ROUND_DOWN) = 1515.83.
  let INSTALLMENT_TOTAL: Decimal;
  const PRIOR_PARTIAL = 800; // first lump — leaves a shortage > 1฿ (non-completing partial)

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
      // PR-843/I2 Phase 3 3a/3c/3d — REQUIRED primitive + VAT-60-day reversal
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

  /** The single receipt JE for an installment (asserts there is exactly one). */
  const onlyReceiptEntry = async (instId: string) => {
    const entries = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: 'receipt' } } as any,
          { metadata: { path: ['installmentScheduleId'], equals: instId } } as any,
        ],
      },
      include: { lines: true },
    });
    expect(entries).toHaveLength(1);
    return entries[0];
  };

  /**
   * Build a fresh 17K/12M FINANCE contract + activate it + create a PENDING
   * Payment row for `installmentNo` (NON-LAST — default #1 — to avoid the 2A
   * trueup-residual seam). amountDue == installmentTotal so a completing receipt
   * never underpays. Optional lateFee seeds a non-waived overdue penalty.
   */
  const seedContract = async (
    journal: JournalAutoService,
    opts: { installmentNo?: number; lateFee?: number } = {},
  ): Promise<{ contractId: string; instId: string; paymentId: string }> => {
    const installmentNo = opts.installmentNo ?? 1;
    const lateFee = opts.lateFee ?? 0;
    const c = await seedStandard17k12m(prisma as any);
    contractIds.push(c.id);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const payment = await prisma.payment.create({
      data: {
        contractId: c.id,
        installmentNo,
        // dueDate in the past when a lateFee is seeded (coherent overdue row);
        // future otherwise (no real-time recompute — applyCreditBalance trusts
        // the persisted payment.lateFee regardless, but keep the row coherent).
        dueDate: new Date(Date.now() + (lateFee > 0 ? -30 : 30) * DAY_MS),
        amountDue: INSTALLMENT_TOTAL.toNumber(),
        amountPaid: 0,
        lateFee,
        // lateFeeWaived=false when a fee is seeded so it is honoured; true otherwise
        // (deterministic — applyCreditBalance does not recompute).
        lateFeeWaived: lateFee > 0 ? false : true,
        status: lateFee > 0 ? 'OVERDUE' : 'PENDING',
      },
    });
    const inst = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId: c.id, installmentNo },
    });
    return { contractId: c.id, instId: inst.id, paymentId: payment.id };
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    await seedFinanceCoa(prisma as any);

    // 21-5101 (เงินเกินของลูกค้า / Customer Credit Balance) is the Dr leg of the
    // credit-application JE. It is a real production account but is NOT in the
    // 99-account CPA test fixture seeded by seedFinanceCoa (PR 3c hit the same
    // gap), so the credit cases below would otherwise throw "Account code not
    // found in CoA". Upserted idempotently (left in place like the rest of CoA).
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
          taxId: '9999999999996',
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

  it('(a) credit COMPLETES an installment with a PRIOR 800 partial → credit JE clears ONLY the remaining delta (tag:receipt, Dr 21-5101, Σ Cr 11-2103 == installmentTotal — no double)', async () => {
    const journal = new JournalAutoService(prisma as any);
    const { contractId, instId, paymentId } = await seedContract(journal);

    // STEP 1 — post the PRIOR 800 partial as a REAL receipt (recordPayment),
    // so the primitive reconstructs it when the credit completes the remainder.
    const partial = await payments.recordPayment(
      contractId,
      1,
      PRIOR_PARTIAL,
      'BANK_TRANSFER',
      adminId,
      'https://example.test/slip-credit-prior.jpg',
      undefined,
      'e2e-credit-prior-partial',
      '11-1101',
      undefined,
      'PARTIAL',
    );
    expect(partial.status).toBe('PARTIALLY_PAID');
    expect(Number(partial.amountPaid)).toBeCloseTo(PRIOR_PARTIAL, 2);
    expect(await countReceiptEntries(instId)).toBe(1);

    // STEP 2 — set creditBalance to EXACTLY the remaining delta so the credit
    // application completes the installment.
    const remaining = Math.round((INSTALLMENT_TOTAL.toNumber() - PRIOR_PARTIAL) * 100) / 100; // 715.83
    await prisma.contract.update({
      where: { id: contractId },
      data: { creditBalance: remaining },
    });

    const res = await payments.applyCreditBalance(contractId, adminId);
    expect(res.allocatedPayments).toHaveLength(1);
    expect(res.allocatedPayments[0].status).toBe('PAID');
    expect(res.creditUsed).toBeCloseTo(remaining, 2);
    expect(res.creditRemaining).toBeCloseTo(0, 2);

    // The credit application posted a SECOND receipt JE (delta-clear via primitive).
    expect(await countReceiptEntries(instId)).toBe(2);

    // Find the credit JE (the one whose Dr 21-5101 leg exists) and assert its shape.
    const entries = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: 'receipt' } } as any,
          { metadata: { path: ['installmentScheduleId'], equals: instId } } as any,
        ],
      },
      include: { lines: true },
    });
    const creditJe = entries.find((e) =>
      e.lines.some((l) => l.accountCode === '21-5101' && Number(l.debit) > 0),
    );
    expect(creditJe).toBeDefined();
    // tag:'receipt' (NOT 'credit-allocation'), + canonical metadata keys present.
    expect((creditJe!.metadata as any).tag).toBe('receipt');
    expect((creditJe!.metadata as any).installmentScheduleId).toBe(instId);
    expect((creditJe!.metadata as any).paymentId).toBe(paymentId);
    // Dr 21-5101 == the remaining delta (NOT cash, NOT cumulative).
    const dr21 = creditJe!.lines
      .filter((l) => l.accountCode === '21-5101')
      .reduce((s, l) => s + Number(l.debit), 0);
    expect(dr21).toBeCloseTo(remaining, 2);

    // THE INVARIANT — Σ Cr 11-2103 across BOTH receipt JEs == installmentTotal.
    // (the credit cleared ONLY the 715.83 delta, NOT the full 1515.83 a 2nd time.)
    expect((await sumSide(instId, '11-2103', 'credit')).toFixed(2)).toBe(
      INSTALLMENT_TOTAL.toFixed(2),
    );

    // The Payment row is PAID at the cumulative amount.
    const fresh = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(fresh.status).toBe('PAID');
    expect(Number(fresh.amountPaid)).toBeCloseTo(INSTALLMENT_TOTAL.toNumber(), 2);
  }, 180_000);

  it('(b) a PARTIAL credit application (credit < amountDue) is now LEDGERED — receipt JE exists, isFinalReceipt=false (installment stays PARTIALLY_PAID)', async () => {
    const journal = new JournalAutoService(prisma as any);
    const { contractId, instId, paymentId } = await seedContract(journal);

    const PARTIAL_CREDIT = 500; // < installmentTotal → non-completing partial
    await prisma.contract.update({
      where: { id: contractId },
      data: { creditBalance: PARTIAL_CREDIT },
    });

    const res = await payments.applyCreditBalance(contractId, adminId);
    expect(res.allocatedPayments).toHaveLength(1);
    expect(res.allocatedPayments[0].status).toBe('PARTIALLY_PAID');
    expect(res.creditUsed).toBeCloseTo(PARTIAL_CREDIT, 2);
    expect(res.creditRemaining).toBeCloseTo(0, 2);

    // Pre-3d this posted NO JE (full-only). Now the partial is LEDGERED:
    // exactly one receipt JE for this installment.
    expect(await countReceiptEntries(instId)).toBe(1);
    const je = await onlyReceiptEntry(instId);
    expect((je.metadata as any).tag).toBe('receipt');
    expect((je.metadata as any).paymentId).toBe(paymentId);

    // Dr 21-5101 == the partial credit; Cr 11-2103 == the same (clears only delta).
    const dr21 = je.lines.filter((l) => l.accountCode === '21-5101').reduce((s, l) => s + Number(l.debit), 0);
    const cr11 = je.lines.filter((l) => l.accountCode === '11-2103').reduce((s, l) => s + Number(l.credit), 0);
    expect(dr21).toBeCloseTo(PARTIAL_CREDIT, 2);
    expect(cr11).toBeCloseTo(PARTIAL_CREDIT, 2);

    // isFinalReceipt=false → installment NOT closed; Payment stays PARTIALLY_PAID.
    const fresh = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(fresh.status).toBe('PARTIALLY_PAID');
    expect(Number(fresh.amountPaid)).toBeCloseTo(PARTIAL_CREDIT, 2);
  }, 180_000);

  it('(c) late-fee variant: credit-funded late fee books as Cr 42-1103 income, Σ Dr 21-5101 == payAmount (Dr total unchanged) [ACCOUNTANT SIGN-OFF]', async () => {
    const journal = new JournalAutoService(prisma as any);
    const LATE_FEE = 100;
    const { contractId, instId, paymentId } = await seedContract(journal, { lateFee: LATE_FEE });

    // amountDue + lateFee = installmentTotal + 100. Set credit to cover it fully
    // so the installment completes and the FULL late fee is funded by credit.
    const payAmount = Math.round((INSTALLMENT_TOTAL.toNumber() + LATE_FEE) * 100) / 100;
    await prisma.contract.update({
      where: { id: contractId },
      data: { creditBalance: payAmount },
    });

    const res = await payments.applyCreditBalance(contractId, adminId);
    expect(res.allocatedPayments).toHaveLength(1);
    expect(res.allocatedPayments[0].status).toBe('PAID');
    expect(res.creditUsed).toBeCloseTo(payAmount, 2);

    // One credit receipt JE for this installment.
    const je = await onlyReceiptEntry(instId);
    expect((je.metadata as any).tag).toBe('receipt');
    expect((je.metadata as any).paymentId).toBe(paymentId);

    // Cr 42-1103 == lateFee (the late fee is now split to income — the change).
    const cr42 = je.lines.filter((l) => l.accountCode === '42-1103').reduce((s, l) => s + Number(l.credit), 0);
    expect(cr42).toBeCloseTo(LATE_FEE, 2);
    // Cr 11-2103 == installmentTotal (principal cleared, late fee excluded).
    const cr11 = je.lines.filter((l) => l.accountCode === '11-2103').reduce((s, l) => s + Number(l.credit), 0);
    expect(cr11).toBeCloseTo(INSTALLMENT_TOTAL.toNumber(), 2);
    // Dr 21-5101 total == payAmount (= principal + late fee). The Dr total is
    // UNCHANGED by the split; only the Cr side now separates 42-1103 from 11-2103.
    const dr21 = je.lines.filter((l) => l.accountCode === '21-5101').reduce((s, l) => s + Number(l.debit), 0);
    expect(dr21).toBeCloseTo(payAmount, 2);

    // The JE balances (Dr 21-5101 == Cr 11-2103 + Cr 42-1103).
    expect(dr21).toBeCloseTo(cr11 + cr42, 2);
  }, 180_000);
});
