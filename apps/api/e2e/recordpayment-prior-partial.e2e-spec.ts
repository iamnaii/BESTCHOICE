/**
 * REPRODUCE-BEFORE-FIX — REAL-DB e2e test for a SUSPECTED latent bug in
 * `PaymentsService.recordPayment` when COMPLETING a prior PARTIAL payment.
 *
 * THE HYPOTHESIS UNDER TEST
 * -------------------------
 * `recordPayment` is suspected to THROW "exceeds tolerance" in production when a
 * customer COMPLETES an installment that was previously paid in part, because it
 * forwards the per-call DELTA (not the cumulative amount) into the
 * `PaymentReceipt2BTemplate` NON-partialClear path, which always clears the FULL
 * `installmentTotal` and rejects `|amountReceived − installmentTotal| > 1฿`.
 *
 * SOURCE EVIDENCE (read to derive the mechanism — NOT modified by this test):
 *   - payments.service.ts:319-329 — `isPartialClear` is set true ONLY when THIS
 *     payment leaves a shortage > 1฿ (a NON-completing partial). On the
 *     COMPLETING receipt (shortage ≤ 1฿) `isPartialClear` stays FALSE.
 *   - payments.service.ts:410-420 — calls `paymentReceipt2BTemplate.execute` with
 *     `amountReceived = amount` (the per-call DELTA) and
 *     `partialClear: isPartialClear ? true : undefined`. So on completion the
 *     template gets: DELTA + non-partialClear.
 *   - payment-receipt-2b.template.ts:172-189 — non-partialClear computes
 *     `roundingDiff = amountReceived + advConsume − installmentTotal − advCredit
 *     − lateFee` and THROWS `BadRequestException('… exceeds tolerance 1.00')`
 *     when `|roundingDiff| > 1.00`. For a completion of a prior partial
 *     (amountReceived = installmentTotal − priorPaid, priorPaid > 1฿)
 *     `roundingDiff ≈ −priorPaid` → throw.
 *
 * Why existing UNIT tests miss it: payments.service.advance.spec.ts (prevPaid=800,
 * pay 200) MOCKS the 2B template, so the real tolerance throw never runs. This
 * test stands up the REAL service + REAL template against a REAL DB so the throw
 * (if any) actually fires.
 *
 * APPROACH A (END-TO-END) — chosen.
 * We construct the REAL `PaymentsService` directly (rather than booting the full
 * heavyweight `PaymentsModule`, whose graph pulls LineOa/Mdm/PaySolutions/etc.
 * and needs env config). Money-critical collaborators are REAL instances wired
 * to one `new PrismaService()`:
 *   PrismaService, JournalAutoService, PaymentReceipt2BTemplate, ProductsService,
 *   AuditService, ReceiptsService, BadDebtService (+ its 3 real JE templates).
 * The post-commit side-effect collaborators (LineOa / FlexTemplates / QuickReply)
 * are harmless stubs — `sendPaymentSuccessLine` short-circuits when the customer
 * has no `lineIdFinance` (ours does not) AND is try/catch-wrapped, so they are
 * never reached before/after the throw. The @Optional() deps (mdmAuto,
 * promiseService, mdmLockService, accountRoleService) are passed `undefined`.
 *
 * HARNESS: only `e2e/jest-e2e.json` (run by `npm run test:e2e`) matches
 * `e2e/.*\.e2e-spec\.ts$`; the main jest config ignores this file. Mirrors the
 * proven real-DB pattern in `e2e/overdue-late-fee.e2e-spec.ts`:
 *   - `HAS_DB` skip-gate (`describe.skip` when DATABASE_URL is absent),
 *   - `new PrismaService()` in beforeAll,
 *   - SCOPED self-cleanup in afterAll (delete ONLY the ids we created — never an
 *     unscoped wipe; the dev DB must survive).
 *
 * To run locally:
 *   export DATABASE_URL="postgresql://iamnaii@localhost:5432/bestchoice"
 *   cd apps/api && npm run test:e2e -- recordpayment-prior-partial
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { seedFinanceCoa } from '../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../src/modules/journal/__tests__/scenario-helpers';

const HAS_DB = !!process.env.DATABASE_URL;
const describeOrSkip = HAS_DB ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;

describeOrSkip('PaymentsService.recordPayment — completing a PRIOR PARTIAL (real DB e2e)', () => {
  let prisma: PrismaService;
  let payments: PaymentsService;

  // ids we created — torn down (scoped) in afterAll.
  let contractId: string;
  let paymentId: string;
  let adminId: string;
  // Only deleted in afterAll if WE created it (a dev DB may already have a FINANCE co).
  let createdFinanceCompanyId: string | null = null;

  // installmentTotal for the standard 17K/12M fixture = 1515.83 (per accounting.md).
  const INSTALLMENT_TOTAL = 1515.83;
  const PARTIAL_AMOUNT = 800; // first payment — leaves a shortage > 1฿ → must use case='PARTIAL'
  const REMAINING = Math.round((INSTALLMENT_TOTAL - PARTIAL_AMOUNT) * 100) / 100; // 715.83

  // captured for the report assertions
  let completionThrew = false;
  let completionError: Error | null = null;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    // --- accounting chart + system admin (JournalAutoService.resolveSystemUserId
    //     looks up admin@bestchoice.com) -----------------------------------
    await seedFinanceCoa(prisma as any);
    const admin = await prisma.user.upsert({
      where: { email: 'admin@bestchoice.com' },
      create: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      update: {},
    });
    adminId = admin.id;

    // resolveFinanceCompanyId() (payments.service.ts:83) requires a
    // companyCode='FINANCE' CompanyInfo or it throws "FINANCE company not
    // configured". seedStandard17k12m only creates 'TEST_FINANCE', and CI's
    // freshly-migrated DB has no FINANCE company — so ensure one exists
    // (find-or-create; a no-op on a dev DB that already has it). Distinct taxId
    // from TEST_FINANCE (0000000000000) to avoid a unique-constraint collision.
    const existingFin = await prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!existingFin) {
      const fin = await prisma.companyInfo.create({
        data: {
          nameTh: 'E2E Finance Co.',
          taxId: '9999999999999',
          companyCode: 'FINANCE',
          address: '1 E2E Rd.',
          directorName: 'E2E Director',
          vatRegistered: true,
          vatRate: '0.0700',
        },
      });
      createdFinanceCompanyId = fin.id;
    }

    // --- the standard 17K/12M FINANCE contract + 12 InstallmentSchedule rows --
    const c = await seedStandard17k12m(prisma as any);
    contractId = c.id;

    // Run Template 1A (contract activation) so the HP receivable JE exists,
    // mirroring the proven payment-receipt-2b.template.spec.ts setup().
    const journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // --- recordPayment needs a Payment ROW for installment #1 (the seed helper
    //     creates InstallmentSchedule rows only, no Payment rows).
    //     IMPORTANT GOTCHA: dueDate is set in the FUTURE + lateFeeWaived=true so
    //     recordPayment's real-time late-fee recompute (payments.service.ts:271-282)
    //     stays 0 and does NOT confound the delta-vs-cumulative arithmetic we are
    //     probing. amountDue = installmentTotal, amountPaid = 0, status PENDING.
    const payment = await prisma.payment.create({
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
    paymentId = payment.id;

    // --- wire the REAL PaymentsService (Approach A) -------------------------
    const receiptVoidReversal = new ReceiptVoidReversalTemplate(journal, prisma as any);
    const paymentReceipt2B = new PaymentReceipt2BTemplate(journal, prisma as any);
    // PR-843/I2 Phase 3 3a — recordPayment now posts via the primitive + the
    // VAT-60-day reversal, both REQUIRED constructor params. Real instances
    // wired to the same prisma so the JE actually posts against the real DB.
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

    // Post-commit side-effect collaborators. sendPaymentSuccessLine short-circuits
    // (customer has no lineIdFinance) AND is try/catch-wrapped, so these stubs are
    // never actually invoked. They exist only to satisfy the (non-optional)
    // constructor params.
    const lineOaStub = { sendFlexMessage: async () => undefined } as any;
    const flexStub = { paymentReceipt: () => ({ quickReply: undefined }) } as any;
    const quickReplyStub = { afterPayment: () => [] } as any;

    payments = new PaymentsService(
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
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    // FK-safe scoped cleanup — ONLY the rows tied to our contract. The dev DB
    // (admin user, FINANCE company, CoA, other contracts) must survive.
    // Each step is independently guarded so one failure cannot abort the rest
    // (defensive — e.g. audit_logs is IMMUTABLE and must never be deleted).
    const step = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch {
        /* best-effort cleanup — never fail the suite on teardown */
      }
    };
    try {
      if (!contractId) return;
      const jeIds: string[] = [];
      await step(async () => {
        const j1 = await prisma.journalEntry.findMany({
          where: { referenceId: contractId },
          select: { id: true },
        });
        // 2B tags via metadata.contractId, not referenceId — catch both.
        const j2 = await prisma.journalEntry.findMany({
          where: { metadata: { path: ['contractId'], equals: contractId } } as any,
          select: { id: true },
        });
        for (const e of [...j1, ...j2]) if (!jeIds.includes(e.id)) jeIds.push(e.id);
      });
      if (jeIds.length) {
        await step(() => prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } }));
        await step(() => prisma.journalEntry.deleteMany({ where: { id: { in: jeIds } } }));
      }
      await step(() => prisma.receipt.deleteMany({ where: { contractId } }));
      await step(() => prisma.loyaltyPoint.deleteMany({ where: { contractId } }));
      await step(() =>
        prisma.partialPaymentLink.deleteMany({ where: { payment: { contractId } } }),
      );
      // NOTE: audit_logs is IMMUTABLE (DB trigger T2-C4 blocks DELETE). The few
      // PAYMENT_RECORDED/PAYMENT_PARTIAL rows we wrote are append-only by design
      // (entityId is a plain string, not an FK) and are reaped by the retention
      // cron — intentionally NOT deleted here.
      await step(() => prisma.payment.deleteMany({ where: { contractId } }));
      await step(() => prisma.installmentSchedule.deleteMany({ where: { contractId } }));
      await step(() => prisma.contract.deleteMany({ where: { id: contractId } }));
      if (createdFinanceCompanyId) {
        await step(() =>
          prisma.companyInfo.deleteMany({ where: { id: createdFinanceCompanyId! } }),
        );
      }
    } finally {
      await prisma.$disconnect();
    }
  }, 120_000);

  it('STEP 1 — a NON-completing PARTIAL (pay 800 of 1515.83) SUCCEEDS and posts a partialClear JE', async () => {
    const res = await payments.recordPayment(
      contractId,
      1,
      PARTIAL_AMOUNT,
      'BANK_TRANSFER',
      adminId,
      'https://example.test/slip-partial.jpg',
      undefined,
      'e2e-prior-partial-step1',
      '11-1101',
      undefined,
      'PARTIAL',
    );

    expect(res.status).toBe('PARTIALLY_PAID');
    expect(Number(res.amountPaid)).toBeCloseTo(PARTIAL_AMOUNT, 2);

    // PR-843/I2 Phase 3 3a — recordPayment now posts via the PaymentReceiptTemplate
    // primitive (tag:'receipt', NOT the legacy tag:'2B'). The partial-clear receipt
    // posts Dr cash 800 / Cr 11-2103 800 (clears only the delta). Assert the primitive
    // receipt JE exists for THIS installment and credited 11-2103 by exactly 800.
    const inst = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId, installmentNo: 1 },
    });
    const receiptJe = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: 'receipt' } } as any,
          { metadata: { path: ['installmentScheduleId'], equals: inst.id } } as any,
        ],
      },
      include: { lines: true },
      orderBy: { postedAt: 'desc' },
    });
    expect(receiptJe).not.toBeNull();
    const cr11 = receiptJe!.lines
      .filter((l) => l.accountCode === '11-2103')
      .reduce((s, l) => s + Number(l.credit), 0);
    expect(cr11).toBeCloseTo(PARTIAL_AMOUNT, 2);
  }, 120_000);

  it('STEP 2 — COMPLETING the remainder (pay 715.83) SUCCEEDS (PAID) — the 3a fix', async () => {
    // remaining = installmentTotal − priorPaid = 1515.83 − 800 = 715.83.
    // PR-843/I2 Phase 3 3a: recordPayment now forwards this DELTA (715.83) to the
    // PaymentReceiptTemplate primitive, which RECONSTRUCTS the prior 800 cleared and
    // clears ONLY the 715.83 remaining → NO "exceeds tolerance" throw. Pre-3a this hit
    // the legacy non-split 2B path (roundingDiff ≈ 715.83 − 1515.83 = −800 → threw).
    // The dual-branch capture is retained so a REGRESSION (the throw coming back) is
    // pinned with its exact message rather than a bare "promise rejected".
    try {
      const res = await payments.recordPayment(
        contractId,
        1,
        REMAINING,
        'BANK_TRANSFER',
        adminId,
        'https://example.test/slip-complete.jpg',
        undefined,
        'e2e-prior-partial-step2',
        '11-1101',
        undefined,
        undefined, // NOT 'PARTIAL' — this is the completing receipt
      );
      // If we reach here the completion SUCCEEDED → hypothesis REFUTED.
      completionThrew = false;
      const fresh = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      // Record the actual end-state so the report reflects reality.
      // eslint-disable-next-line no-console
      console.log(
        `[VERDICT] completion SUCCEEDED — status=${fresh.status} amountPaid=${fresh.amountPaid.toString()} ` +
          `(returned status=${res.status})`,
      );
    } catch (err) {
      completionThrew = true;
      completionError = err as Error;
      // eslint-disable-next-line no-console
      console.log(`[VERDICT] completion THREW — ${(err as Error).message}`);
    }

    // POST-3a EXPECTATION: completion MUST succeed (no throw). If the throw ever
    // returns (regression), surface its exact message so the cause is unambiguous.
    if (completionThrew) {
      throw new Error(
        `REGRESSION — completing a prior partial THREW after 3a: ${completionError?.message}`,
      );
    }
    // Success end-state: installment fully PAID, amountPaid == installmentTotal.
    const fresh = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(fresh.status).toBe('PAID');
    expect(Number(fresh.amountPaid)).toBeCloseTo(INSTALLMENT_TOTAL, 2);
  }, 120_000);
});
