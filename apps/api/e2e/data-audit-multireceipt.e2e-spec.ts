/**
 * REAL-DB e2e — PR-843/I2 Phase 3 PR 3.1-audit (the /financial-audit fix).
 *
 * WHAT THIS PROVES
 * ----------------
 * The epic posts MULTIPLE receipt JEs per Payment, all sharing the SAME
 * `metadata.paymentId`; the JE's scalar `referenceId` is now a fresh random
 * UUID (it equals payment.id only on LEGACY 2B / split-final JEs). The
 * data-audit checks USED to find a payment's JE by `je.reference_id = p.id`,
 * which MISSES the new primitive receipt JEs → a paid multi-receipt payment
 * would be FALSELY flagged as an orphan, and per-payment reconciliation sums
 * would be FALSELY reported as mismatched.
 *
 * This file exercises the BROADENED raw SQL of two checks against a real DB,
 * on a genuine 2-receipt payment:
 *
 *  PART 1 — ORPHAN. `checkOrphanPayments()` runs the broadened EXISTS predicate
 *    `(je.reference_id = p.id::text OR je.metadata->>'paymentId' = p.id::text)`.
 *    Our payment's TWO receipt JEs are posted by the REAL PaymentReceiptTemplate
 *    (referenceId = random UUID, metadata.paymentId = our payment). On UNCHANGED
 *    code (reference_id-only match) the payment is a FALSE orphan; here it must
 *    NOT appear in the orphan details.
 *
 *  PART 2 — COMMISSION RECONCILIATION. `checkCommissionMismatch()` runs the
 *    broadened CTE that GROUPs BY `COALESCE(je.metadata->>'paymentId',
 *    je.reference_id)` and matches by metadata.paymentId. We post TWO AUTO JEs
 *    (referenceId = random UUID, metadata.paymentId = our payment) that EACH
 *    credit 42-1105, splitting the commission across the two receipts, and set
 *    payment.monthlyCommission = their SUM. The check must SUM both JEs and find
 *    NO mismatch. On UNCHANGED code (GROUP BY reference_id) each JE groups under
 *    its own UUID, neither equals payment.id → journal_comm = NULL → FALSE
 *    mismatch.
 *
 * Assertions are SCOPED to our payment id (not a global count) so pre-existing
 * dev data never makes the test flaky.
 *
 * HARNESS mirrors multireceipt-reversal.e2e-spec.ts: HAS_DB skip-gate,
 * `new PrismaService()`, SCOPED self-cleanup (audit_logs NEVER deleted).
 *
 * Run:
 *   export DATABASE_URL="postgresql://iamnaii@localhost:5432/bestchoice"
 *   cd apps/api && npm run test:e2e -- data-audit-multireceipt
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { JournalAutoService } from '../src/modules/journal/journal-auto.service';
import { PaymentReceiptTemplate } from '../src/modules/journal/cpa-templates/payment-receipt.template';
import { ContractActivation1ATemplate } from '../src/modules/journal/cpa-templates/contract-activation-1a.template';
import { DataAuditService } from '../src/modules/data-audit/data-audit.service';
import { computeInstallmentBreakdown } from '../src/modules/journal/compute-installment-breakdown';
import { seedFinanceCoa } from '../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../src/modules/journal/__tests__/scenario-helpers';

const HAS_DB = !!process.env.DATABASE_URL;
const describeOrSkip = HAS_DB ? describe : describe.skip;

describeOrSkip('Data-audit multi-receipt — PR-843/I2 Phase 3 PR 3.1-audit (real DB e2e)', () => {
  let prisma: PrismaService;
  let journal: JournalAutoService;
  let template: PaymentReceiptTemplate;
  let audit: DataAuditService;

  let contractId: string;
  let instId: string;
  let installmentTotal: Decimal;
  let createdFinanceCompanyId: string | null = null;

  // The shared payment id the receipt JEs all stamp into metadata.paymentId.
  let paymentId: string;
  // commission split across the two commission JEs (sum stored on payment).
  const commLeg1 = new Decimal('60.00');
  const commLeg2 = new Decimal('40.00');
  const commTotal = commLeg1.plus(commLeg2); // 100.00

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await seedFinanceCoa(prisma as any);

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

    const c = await seedStandard17k12m(prisma as any);
    contractId = c.id;
    journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // ROUND_DOWN installmentTotal (1515.83) — same rationale as the sibling e2e.
    installmentTotal = computeInstallmentBreakdown({
      financedAmount: c.financedAmount.toString(),
      storeCommission: c.commission != null ? c.commission.toString() : null,
      interestTotal: c.interest.toString(),
      vatAmount: c.vatTotal != null ? c.vatTotal.toString() : null,
      totalMonths: c.installmentCount,
    }).installmentTotal;

    const inst = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId, installmentNo: 1 },
    });
    instId = inst.id;

    // The caller-owned Payment row both receipt JEs reference via paymentId.
    // monthlyCommission == the SUM of the two 42-1105 commission legs, so the
    // commission reconciliation only balances if the check SUMS both JEs.
    const payment = await prisma.payment.create({
      data: {
        contractId,
        installmentNo: 1,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        amountDue: installmentTotal.toFixed(2),
        amountPaid: installmentTotal.toFixed(2),
        paidDate: new Date(),
        status: 'PAID',
        monthlyCommission: commTotal.toFixed(2),
      },
    });
    paymentId = payment.id;

    template = new PaymentReceiptTemplate(journal, prisma as any);
    audit = new DataAuditService(prisma as any, journal);

    // ── Post the genuine 2-receipt payment via the REAL primitive ──────────
    // Receipt #1 — PARTIAL of 500 on installment #1.
    await template.execute({
      installmentScheduleId: instId,
      delta: new Decimal('500'),
      debitAccountCode: '11-1101',
      paymentId,
      idempotencyKey: `${paymentId}:r1`,
    });
    // Receipt #2 — the COMPLETION (remaining delta), SAME paymentId.
    await template.execute({
      installmentScheduleId: instId,
      delta: installmentTotal.minus(500),
      debitAccountCode: '11-1101',
      isFinalReceipt: true,
      paymentId,
      idempotencyKey: `${paymentId}:r2`,
    });

    // ── Post TWO commission JEs in the NEW receipt shape ───────────────────
    // referenceId = random UUID (NOT paymentId); payment link = metadata.paymentId.
    // Each credits 42-1105; together they sum to the payment's monthlyCommission.
    // (The standard receipt primitive does not post 42-1105, so we post these
    //  directly via createAndPost to exercise the commission CTE aggregation —
    //  they carry the SAME metadata.paymentId shape the audit must group on.)
    const postCommissionLeg = async (amt: Decimal) =>
      journal.createAndPost({
        description: `e2e commission leg — payment ${paymentId}`,
        reference: randomUUID(), // → referenceType 'AUTO', referenceId = UUID
        metadata: { tag: 'receipt', flow: 'payment-receipt', paymentId },
        lines: [
          { accountCode: '11-1101', dr: amt, cr: new Decimal(0) },
          { accountCode: '42-1105', dr: new Decimal(0), cr: amt },
        ],
      });
    await postCommissionLeg(commLeg1);
    await postCommissionLeg(commLeg2);
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
      if (contractId) {
        const jes = await prisma.journalEntry.findMany({
          where: {
            OR: [
              { referenceId: contractId },
              { metadata: { path: ['contractId'], equals: contractId } as any },
              ...(paymentId
                ? [{ metadata: { path: ['paymentId'], equals: paymentId } as any }]
                : []),
            ],
          },
          select: { id: true },
        });
        const ids = jes.map((e) => e.id);
        if (ids.length) {
          await step(() => prisma.journalLine.deleteMany({ where: { journalEntryId: { in: ids } } }));
          await step(() => prisma.journalEntry.deleteMany({ where: { id: { in: ids } } }));
        }
        // audit_logs / data_audit_logs are append-only — never deleted here.
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

  it('PART 1 — checkOrphanPayments does NOT false-flag the 2-receipt payment (matched via metadata.paymentId)', async () => {
    // Sanity: our two receipt JEs exist, both keyed only by metadata.paymentId.
    const receiptJEs = await prisma.journalEntry.findMany({
      where: {
        metadata: { path: ['paymentId'], equals: paymentId } as any,
        referenceType: 'AUTO',
        status: 'POSTED',
        deletedAt: null,
      },
      select: { id: true, referenceId: true },
    });
    // 2 receipts + 2 commission legs = 4 JEs, all carrying metadata.paymentId,
    // none with referenceId == paymentId (all fresh UUIDs).
    expect(receiptJEs.length).toBeGreaterThanOrEqual(2);
    expect(receiptJEs.every((e) => e.referenceId !== paymentId)).toBe(true);

    const result = await audit.checkOrphanPayments();
    const orphanIds = (result.details as { id: string }[]).map((d) => d.id);
    // The whole point: our paid multi-receipt payment is NOT a false orphan.
    expect(orphanIds).not.toContain(paymentId);
  }, 120_000);

  it('PART 2 — checkCommissionMismatch SUMS both 42-1105 JEs of the payment (no false mismatch)', async () => {
    const result = await audit.checkCommissionMismatch();
    const mismatchIds = (result.details as { id: string }[]).map((d) => d.id);
    // Σ(Cr 42-1105) over the payment's TWO JEs == payment.monthlyCommission, so
    // the broadened CTE (GROUP BY COALESCE(metadata.paymentId, reference_id))
    // finds NO mismatch for our payment.
    expect(mismatchIds).not.toContain(paymentId);

    // Cross-check the aggregation directly against the broadened grouping key,
    // proving Σ == commTotal (both legs summed under one metadata.paymentId).
    const rows = await prisma.$queryRaw<{ journal_comm: Decimal }[]>`
      SELECT SUM(jl.credit) as journal_comm
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = '42-1105'
        AND je.reference_type = 'AUTO'
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL AND jl.deleted_at IS NULL
        AND je.metadata->>'paymentId' = ${paymentId}
      GROUP BY COALESCE(je.metadata->>'paymentId', je.reference_id)
    `;
    expect(rows.length).toBe(1); // both legs grouped into ONE row
    expect(new Decimal(rows[0].journal_comm.toString()).toFixed(2)).toBe(commTotal.toFixed(2));
  }, 120_000);
});
