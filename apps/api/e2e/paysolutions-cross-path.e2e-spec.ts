/**
 * REAL-DB e2e — PR-843/I2 Phase 3 3b: the PaySolutions QR webhook
 * (`PaySolutionsService.handlePaymentCallback`) wired onto the
 * `PaymentReceiptTemplate` primitive (replacing the legacy 2B path).
 *
 * THE INVARIANT UNDER TEST
 * ------------------------
 * A cashier posts a NON-completing PARTIAL of 800 via the REAL
 * `PaymentsService.recordPayment(..., 'PARTIAL')` (3a path → tag:'receipt' JE that
 * clears 11-2103 by exactly 800). Then a PaySolutions QR webhook COMPLETES the
 * same installment. Pre-3b the webhook posted the legacy 2B JE with
 * `amountReceived = cumulative amountPaid` → it would clear the FULL installmentTotal
 * AGAIN → Σ(Cr 11-2103) = 800 + 1515.83 = 2315.83 (cross-path double-count).
 *
 * POST-3b: the webhook posts the primitive with `delta = payThis` (the per-receipt
 * DELTA, here 715.83 + lateFee). `reconstructPrior` reads the cashier's prior 800,
 * so the completion clears ONLY the remaining 715.83 →
 *   Σ(Cr 11-2103) for the installment == installmentTotal (1515.83) — every baht once.
 * A completing late fee books Cr 42-1103.
 *
 * APPROACH (mirrors recordpayment-prior-partial.e2e-spec.ts + payment-receipt-primitive.e2e-spec.ts):
 *   - Real PrismaService (HAS_DB gate, scoped self-cleanup, audit_logs never deleted).
 *   - Real money-critical collaborators for BOTH services wired to one PrismaService:
 *     JournalAutoService, PaymentReceiptTemplate, Vat60dayReversalTemplate, ProductsService,
 *     ReceiptsService, AuditService, BadDebtService (+3 JE templates) for PaymentsService.
 *   - PaySolutionsService side-effect deps (LineOa / IntegrationConfig / Config /
 *     OnlineOrderSaleAdapter / PaymentsService) are harmless stubs — the notification
 *     helpers short-circuit (customer has no lineIdFinance) and are try/catch-wrapped.
 *   - We drive the SMALLEST real entry point that runs the FIFO+JE logic:
 *     `paysolutions.handlePaymentCallback({...})` against a real PaymentLink row.
 *
 * To run locally:
 *   export DATABASE_URL="postgresql://iamnaii@localhost:5432/bestchoice"
 *   cd apps/api && npm run test:e2e -- paysolutions-cross-path
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaService } from '../src/prisma/prisma.service';
import { PaySolutionsService } from '../src/modules/paysolutions/paysolutions.service';
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

describeOrSkip('PaySolutions webhook — cross-path Σ-invariant (real DB e2e, PR-843/I2 3b)', () => {
  let prisma: PrismaService;
  let paysolutions: PaySolutionsService;
  let payments: PaymentsService;

  let contractId: string;
  let instId: string;
  let paymentId: string; // installment #1 — closed cross-path (cashier partial + webhook completion)
  let lateFeePaymentId: string; // installment #2 — completing late-fee path
  let lateFeeInstId: string;
  let adminId: string;
  let createdFinanceCompanyId: string | null = null;

  // installmentTotal for the standard 17K/12M fixture = 1515.83 (per accounting.md, ROUND_DOWN).
  const INSTALLMENT_TOTAL = 1515.83;
  const CASHIER_PARTIAL = 800;
  const WEBHOOK_COMPLETION = Math.round((INSTALLMENT_TOTAL - CASHIER_PARTIAL) * 100) / 100; // 715.83
  const LATE_FEE = 100;

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

    const c = await seedStandard17k12m(prisma as any);
    contractId = c.id;

    const journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const inst1 = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId, installmentNo: 1 },
    });
    instId = inst1.id;
    const inst2 = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId, installmentNo: 2 },
    });
    lateFeeInstId = inst2.id;

    // Payment rows for the two installments under test. dueDate FUTURE so the
    // real-time late-fee recompute does not confound the cashier partial; the
    // late-fee installment carries an explicit lateFee that is NOT waived.
    const p1 = await prisma.payment.create({
      data: {
        contractId: c.id,
        installmentNo: 1,
        dueDate: new Date(Date.now() + 30 * DAY_MS),
        amountDue: INSTALLMENT_TOTAL,
        amountPaid: 0,
        lateFeeWaived: true,
        status: 'PENDING',
      },
    });
    paymentId = p1.id;

    const p2 = await prisma.payment.create({
      data: {
        contractId: c.id,
        installmentNo: 2,
        dueDate: new Date(Date.now() + 30 * DAY_MS),
        amountDue: INSTALLMENT_TOTAL,
        amountPaid: 0,
        lateFee: LATE_FEE,
        lateFeeWaived: false,
        status: 'PENDING',
      },
    });
    lateFeePaymentId = p2.id;

    // ── REAL PaymentsService (for the cashier PARTIAL on installment #1) ──
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
    const lineOaStub = { sendFlexMessage: async () => undefined } as any;
    const flexStub = { paymentReceipt: () => ({ quickReply: undefined }) } as any;
    const quickReplyStub = { afterPayment: () => [] } as any;

    payments = new PaymentsService(
      prisma as any,
      receipts,
      audit,
      journal,
      products,
      lineOaStub,
      flexStub,
      quickReplyStub,
      badDebt,
      paymentReceiptTemplate,
      vat60Reversal,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    // ── REAL PaySolutionsService (for the completing webhook) ──
    // Money-critical collaborators are REAL (same prisma + journal). Side-effect
    // deps are stubs: the notification helpers short-circuit (no lineIdFinance) and
    // are try/catch-wrapped, so they never throw or fire LINE.
    const integrationConfigStub = { getValue: async () => '' } as any;
    const configStub = { get: (_k: string, def?: string) => def ?? '' } as any;
    const lineOaServiceStub = { sendFlexMessage: async () => undefined } as any;
    const saleAdapterStub = {} as any;
    const paymentsStub = { recordPayment: async () => undefined } as any;

    paysolutions = new PaySolutionsService(
      prisma as any,
      configStub,
      lineOaServiceStub,
      integrationConfigStub,
      saleAdapterStub,
      products,
      journal,
      paymentReceiptTemplate,
      vat60Reversal,
      paymentsStub,
    );
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    const step = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch {
        /* best-effort teardown — never fail on cleanup */
      }
    };
    try {
      if (contractId) {
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
        await step(() => prisma.receipt.deleteMany({ where: { contractId } }));
        await step(() => prisma.loyaltyPoint.deleteMany({ where: { contractId } }));
        await step(() =>
          prisma.partialPaymentLink.deleteMany({ where: { payment: { contractId } } }),
        );
        await step(() => prisma.paymentLink.deleteMany({ where: { contractId } }));
        // audit_logs is IMMUTABLE (DB trigger) — never deleted.
        await step(() => prisma.payment.deleteMany({ where: { contractId } }));
        await step(() => prisma.installmentSchedule.deleteMany({ where: { contractId } }));
        await step(() => prisma.contract.deleteMany({ where: { id: contractId } }));
      }
      if (createdFinanceCompanyId) {
        await step(() => prisma.companyInfo.deleteMany({ where: { id: createdFinanceCompanyId! } }));
      }
    } finally {
      await prisma.$disconnect();
    }
  }, 120_000);

  // Σ(side) across BOTH the cashier-partial JE and the webhook-completion JE for one installment.
  const sumForInstallment = async (
    installmentScheduleId: string,
    accountCode: string,
    side: 'debit' | 'credit',
  ): Promise<number> => {
    const entries = await prisma.journalEntry.findMany({
      where: {
        AND: [
          {
            OR: [
              { metadata: { path: ['tag'], equals: 'receipt' } } as any,
              { metadata: { path: ['tag'], equals: '2B' } } as any,
            ],
          },
          { metadata: { path: ['installmentScheduleId'], equals: installmentScheduleId } } as any,
        ],
      },
      include: { lines: true },
    });
    let sum = 0;
    for (const e of entries) {
      for (const l of e.lines) {
        if (l.accountCode === accountCode) {
          sum += Number(side === 'debit' ? l.debit : l.credit);
        }
      }
    }
    return Math.round(sum * 100) / 100;
  };

  it('STEP 1 — cashier PARTIAL of 800 (recordPayment) posts a receipt JE clearing 11-2103 by exactly 800', async () => {
    const res = await payments.recordPayment(
      contractId,
      1,
      CASHIER_PARTIAL,
      'BANK_TRANSFER',
      adminId,
      'https://example.test/slip-cashier-partial.jpg',
      undefined,
      'e2e-crosspath-cashier',
      '11-1101',
      undefined,
      'PARTIAL',
    );
    expect(res.status).toBe('PARTIALLY_PAID');
    expect(Number(res.amountPaid)).toBeCloseTo(CASHIER_PARTIAL, 2);

    // The 3a path posts a tag:'receipt' JE that clears 11-2103 by exactly 800.
    const cr11 = await sumForInstallment(instId, '11-2103', 'credit');
    expect(cr11).toBeCloseTo(CASHIER_PARTIAL, 2);
  }, 120_000);

  it('STEP 2 — PaySolutions webhook COMPLETES the installment → Σ(Cr 11-2103) == installmentTotal (NOT 2315.83)', async () => {
    // Real PaymentLink row for the completing webhook on installment #1.
    const link = await prisma.paymentLink.create({
      data: {
        token: 'e2e-crosspath-webhook-1',
        contractId,
        paymentId,
        amount: WEBHOOK_COMPLETION,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + DAY_MS),
      },
    });

    await paysolutions.handlePaymentCallback({
      refno: link.token,
      result_code: '00',
      order_no: 'crosspath-o-1',
      transaction_id: 'crosspath-tx-1',
      total: String(WEBHOOK_COMPLETION),
    });

    // Payment fully PAID.
    const fresh = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(fresh.status).toBe('PAID');
    expect(Number(fresh.amountPaid)).toBeCloseTo(INSTALLMENT_TOTAL, 2);

    // THE INVARIANT: Σ(Cr 11-2103) across the cashier partial (800) + the webhook
    // completion (715.83) == installmentTotal exactly. NOT 2315.83 (the pre-3b
    // cross-path double-count where the webhook re-cleared the full installmentTotal).
    const cr11 = await sumForInstallment(instId, '11-2103', 'credit');
    expect(cr11).toBeCloseTo(INSTALLMENT_TOTAL, 2);

    // Two distinct receipt JEs exist for the installment (cashier + webhook),
    // proving the webhook ledgers its own delta rather than consolidating/over-posting.
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
  }, 120_000);

  it('STEP 3 — a completing webhook with a late fee books Cr 42-1103 == lateFee', async () => {
    // Installment #2 carries a 100 lateFee (not waived). The webhook pays
    // amountDue + lateFee = 1515.83 + 100 = 1615.83 → fully PAID, lateFee → 42-1103.
    const completion = Math.round((INSTALLMENT_TOTAL + LATE_FEE) * 100) / 100;
    const link = await prisma.paymentLink.create({
      data: {
        token: 'e2e-crosspath-webhook-2',
        contractId,
        paymentId: lateFeePaymentId,
        amount: completion,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + DAY_MS),
      },
    });

    await paysolutions.handlePaymentCallback({
      refno: link.token,
      result_code: '00',
      order_no: 'crosspath-o-2',
      transaction_id: 'crosspath-tx-2',
      total: String(completion),
    });

    const fresh = await prisma.payment.findUniqueOrThrow({ where: { id: lateFeePaymentId } });
    expect(fresh.status).toBe('PAID');

    // Principal cleared == installmentTotal, and the 100 late fee books Cr 42-1103.
    const cr11 = await sumForInstallment(lateFeeInstId, '11-2103', 'credit');
    expect(cr11).toBeCloseTo(INSTALLMENT_TOTAL, 2);
    const cr42 = await sumForInstallment(lateFeeInstId, '42-1103', 'credit');
    expect(cr42).toBeCloseTo(LATE_FEE, 2);
  }, 120_000);
});
