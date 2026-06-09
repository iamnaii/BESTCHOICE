/**
 * REAL-DB e2e — PR-843/I2 Phase 3 PR 3.1 (the FOUNDATIONAL multi-receipt fix).
 *
 * WHAT THIS PROVES
 * ----------------
 * The epic posts MULTIPLE receipt JEs per Payment (a partial then a completion
 * on one installment), all sharing the SAME `metadata.paymentId`. This file
 * proves two invariants of that design:
 *
 *  PART 1 — NO COLLISION. Two `PaymentReceiptTemplate.execute({..., paymentId})`
 *    calls for the same paymentId post TWO distinct POSTED receipt JEs. On
 *    UNCHANGED code the JE `reference` was `input.paymentId ?? randomUUID()`, so
 *    the 2nd call collided on the partial-unique index
 *    `journal_entries_ref_unique (reference_type, reference_id)` → this test
 *    fails RED until PR 3.1 changes `reference` to ALWAYS-unique `randomUUID()`.
 *
 *  PART 2 — FULL REVERSAL. `ReceiptsService.voidReceipt` must reverse ALL receipt
 *    JEs of the payment (found by `metadata.paymentId`), not just the one whose
 *    `referenceId == paymentId`. We assert the payment's NET Cr 11-2103 returns to
 *    zero after the void (Σ reversal Dr 11-2103 == Σ receipt Cr 11-2103). On
 *    UNCHANGED code only one of the two receipt JEs would be reversed → the net
 *    11-2103 stays non-zero = ledger defect.
 *
 * HARNESS mirrors recordpayment-prior-partial.e2e-spec.ts: HAS_DB skip-gate,
 * `new PrismaService()`, SCOPED self-cleanup (audit_logs NEVER deleted).
 *
 * Run:
 *   export DATABASE_URL="postgresql://iamnaii@localhost:5432/bestchoice"
 *   cd apps/api && npm run test:e2e -- multireceipt-reversal
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../src/prisma/prisma.service';
import { JournalAutoService } from '../src/modules/journal/journal-auto.service';
import { PaymentReceiptTemplate } from '../src/modules/journal/cpa-templates/payment-receipt.template';
import { ContractActivation1ATemplate } from '../src/modules/journal/cpa-templates/contract-activation-1a.template';
import { ReceiptVoidReversalTemplate } from '../src/modules/journal/cpa-templates/receipt-void-reversal.template';
import { ReceiptsService } from '../src/modules/receipts/receipts.service';
import { computeInstallmentBreakdown } from '../src/modules/journal/compute-installment-breakdown';
import { seedFinanceCoa } from '../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../src/modules/journal/__tests__/scenario-helpers';

const HAS_DB = !!process.env.DATABASE_URL;
const describeOrSkip = HAS_DB ? describe : describe.skip;

describeOrSkip('Multi-receipt JE reversal — PR-843/I2 Phase 3 PR 3.1 (real DB e2e)', () => {
  let prisma: PrismaService;
  let journal: JournalAutoService;
  let template: PaymentReceiptTemplate;
  let receipts: ReceiptsService;

  let contractId: string;
  let instId: string;
  let installmentTotal: Decimal;
  let adminId: string;
  let approverId: string;
  let createdFinanceCompanyId: string | null = null;

  // The shared payment id the two receipt JEs both stamp into metadata.paymentId.
  let paymentId: string;

  // Σ Cr 11-2103 of the receipt JEs for THIS payment (computed in the post step).
  let receiptCreditTotal: Decimal = new Decimal(0);

  /** Receipt JEs (POSTED, non-deleted) whose metadata.paymentId == paymentId. */
  const receiptJEsForPayment = async () => {
    return prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['paymentId'], equals: paymentId } } as any,
          { metadata: { path: ['tag'], equals: 'receipt' } } as any,
        ],
        status: 'POSTED',
        deletedAt: null,
      },
      include: { lines: true },
    });
  };

  /**
   * Net Cr 11-2103 for THIS payment = Σ over the payment's receipt JEs PLUS their
   * reversal JEs of (credit − debit). Receipt JEs carry metadata.paymentId; the
   * reversal template stores the original entry id in the scalar `referenceId` column
   * as `<originalEntryId>:void` (Prisma's JSON `path` filter has no `in` operator, so
   * we sweep via the indexed scalar column instead). When every receipt Cr 11-2103 is
   * offset by a reversal Dr 11-2103, the net is exactly 0.
   */
  const netCredit11_2103 = async (): Promise<Decimal> => {
    const receiptJEs = await receiptJEsForPayment();
    const voidRefs = receiptJEs.map((e) => `${e.id}:void`);
    const reversalJEs = voidRefs.length
      ? await prisma.journalEntry.findMany({
          where: { referenceId: { in: voidRefs }, deletedAt: null },
          include: { lines: true },
        })
      : [];
    let net = new Decimal(0);
    for (const e of [...receiptJEs, ...reversalJEs]) {
      for (const l of e.lines) {
        if (l.accountCode !== '11-2103') continue;
        net = net.plus(new Decimal(l.credit.toString())).minus(new Decimal(l.debit.toString()));
      }
    }
    return net;
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
    // A distinct approver — voidReceipt enforces segregation of duties (issuer != approver).
    const approver = await prisma.user.upsert({
      where: { email: 'approver-multireceipt@bestchoice.com' },
      create: {
        email: 'approver-multireceipt@bestchoice.com',
        password: 'x',
        name: 'approver',
        role: 'ACCOUNTANT',
      },
      update: {},
    });
    approverId = approver.id;

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
    journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Re-derive installmentTotal via computeInstallmentBreakdown (ROUND_DOWN = 1515.83),
    // NOT the seed helper's default rounding (1515.84) — same rationale as the
    // payment-receipt-primitive e2e.
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
    const payment = await prisma.payment.create({
      data: {
        contractId,
        installmentNo: 1,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        amountDue: installmentTotal.toFixed(2),
        amountPaid: installmentTotal.toFixed(2),
        paidDate: new Date(),
        status: 'PAID',
      },
    });
    paymentId = payment.id;

    template = new PaymentReceiptTemplate(journal, prisma as any);

    const receiptVoidReversal = new ReceiptVoidReversalTemplate(journal, prisma as any);
    receipts = new ReceiptsService(prisma as any, journal, receiptVoidReversal, undefined);
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
              // Receipt JEs carry metadata.paymentId (not contractId for reversals).
              ...(paymentId
                ? [{ metadata: { path: ['paymentId'], equals: paymentId } as any }]
                : []),
            ],
          },
          select: { id: true },
        });
        // Reversal JEs store the original entry id in the scalar `referenceId` column
        // as `<originalEntryId>:void` — sweep them so they never leak and poison the JE
        // entry-number sequence (count-based) on the next run.
        const voidRefs = jes.map((e) => `${e.id}:void`);
        if (voidRefs.length) {
          const rjes = await prisma.journalEntry.findMany({
            where: { referenceId: { in: voidRefs } },
            select: { id: true },
          });
          for (const r of rjes) if (!jes.find((j) => j.id === r.id)) jes.push(r);
        }
        const ids = jes.map((e) => e.id);
        if (ids.length) {
          await step(() => prisma.journalLine.deleteMany({ where: { journalEntryId: { in: ids } } }));
          await step(() => prisma.journalEntry.deleteMany({ where: { id: { in: ids } } }));
        }
        // audit_logs is IMMUTABLE (DB trigger blocks DELETE) — never deleted here.
        await step(() => prisma.receipt.deleteMany({ where: { contractId } }));
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

  it('PART 1 — TWO receipt JEs share metadata.paymentId with NO unique-index collision', async () => {
    // Receipt #1 — a PARTIAL of 500 on installment #1.
    await template.execute({
      installmentScheduleId: instId,
      delta: new Decimal('500'),
      debitAccountCode: '11-1101',
      paymentId,
      idempotencyKey: `${paymentId}:r1`,
    });

    // Receipt #2 — the COMPLETION (remaining delta), SAME paymentId. On unchanged
    // code this throws a unique-constraint error on journal_entries_ref_unique
    // because both JEs would carry referenceId == paymentId.
    const remainder = installmentTotal.minus(500);
    await template.execute({
      installmentScheduleId: instId,
      delta: remainder,
      debitAccountCode: '11-1101',
      isFinalReceipt: true,
      paymentId,
      idempotencyKey: `${paymentId}:r2`,
    });

    const jes = await receiptJEsForPayment();
    expect(jes.length).toBe(2); // two DISTINCT receipt JEs, no collision

    // Distinct JE references (the whole point of Part 1 — always-unique reference).
    const refs = new Set(jes.map((e) => e.referenceId));
    expect(refs.size).toBe(2);

    // Each stamps the canonical payment key + flow + idempotencyKey.
    for (const e of jes) {
      const meta = e.metadata as any;
      expect(meta.paymentId).toBe(paymentId);
      expect(meta.flow).toBe('payment-receipt');
      expect(typeof meta.idempotencyKey).toBe('string');
    }

    // Σ Cr 11-2103 across BOTH receipt JEs == installmentTotal (every baht cleared once).
    receiptCreditTotal = jes.reduce((acc, e) => {
      const cr = e.lines
        .filter((l) => l.accountCode === '11-2103')
        .reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
      return acc.plus(cr);
    }, new Decimal(0));
    expect(receiptCreditTotal.toFixed(2)).toBe(installmentTotal.toFixed(2));

    // Pre-void: the contract's net Cr 11-2103 == installmentTotal (nothing reversed yet).
    expect((await netCredit11_2103()).toFixed(2)).toBe(installmentTotal.toFixed(2));
  }, 120_000);

  it('PART 2 — voidReceipt reverses ALL receipt JEs of the payment (net 11-2103 → 0)', async () => {
    // A real Receipt row pointing at the shared paymentId — what voidReceipt operates on.
    // Receipt number is unique-per-run (derived from paymentId) so a leftover from a
    // prior failed run never collides on the receipt_number unique index.
    const receiptNumber = `RT-E2E-${paymentId.slice(0, 8)}`;
    const receipt = await prisma.receipt.create({
      data: {
        receiptNumber,
        contractId,
        paymentId,
        receiptType: 'PAYMENT',
        payerName: 'E2E Customer',
        receiverName: 'E2E Cashier',
        amount: installmentTotal.toFixed(2),
        installmentNo: 1,
        paymentMethod: 'CASH',
        paidDate: new Date(),
        issuedById: adminId,
      },
    });

    // issuer (adminId) != approver (approverId) — satisfies segregation of duties.
    const res = await receipts.voidReceipt(receipt.id, 'multi-receipt void e2e', adminId, approverId, 'ACCOUNTANT');
    expect(res.voidedReceipt).toBeDefined();
    expect(res.creditNote).toBeDefined();

    // BOTH receipt JEs must now be flagged reversed.
    const reversedFlags = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['paymentId'], equals: paymentId } } as any,
          { metadata: { path: ['tag'], equals: 'receipt' } } as any,
        ],
      },
      select: { metadata: true },
    });
    expect(reversedFlags.length).toBe(2);
    for (const e of reversedFlags) {
      expect((e.metadata as any).reversed).toBe(true);
    }

    // THE money assertion: after voiding, every receipt JE's Cr 11-2103 is offset
    // by a reversal Dr 11-2103, so the payment's NET 11-2103 returns to zero.
    // On unchanged code (single-JE reversal) this would still read installmentTotal
    // minus only ONE receipt → non-zero = ledger defect.
    expect((await netCredit11_2103()).toFixed(2)).toBe('0.00');
  }, 120_000);
});
