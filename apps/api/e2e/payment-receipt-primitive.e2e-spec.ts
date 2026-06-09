/**
 * REAL-DB e2e for the PaymentReceiptTemplate primitive (PR-843 / I2 Phase 2 + 3).
 * Proves Σ(Cr 11-2103) per installment == installmentTotal and Σ(Cr 42-1103) ==
 * lateFee across ANY receipt sequence, with NO template mocking. Harness mirrors
 * recordpayment-prior-partial.e2e-spec.ts (HAS_DB gate, scoped cleanup).
 *
 * Phase 3 adds two legacy-2B interop cases (installments 7 and 8) that verify
 * reconstructPrior correctly counts a tag:'2B' partial-clear JE and excludes a
 * tag:'2B' full-clear JE. See PR-843/I2 Phase 3 design note in payment-receipt.template.ts.
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
  let journal: JournalAutoService;
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
    // Mirrors PaymentReceiptTemplate.reconstructPrior (Phase 3): tag IN ('receipt','2B')
    // AND installmentScheduleId. Both tags are included so the Σ-invariant proof
    // counts legacy 2B partial-clear JEs alongside primitive receipt JEs. (PR-843/I2 Phase 3)
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
    journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // computeInstallmentBreakdown expects storeCommission/interestTotal/vatAmount/totalMonths
    // but StandardContract exposes commission/interest/vatTotal/installmentCount — map them.
    // MUST re-derive here: c.installmentTotal from the seed uses default rounding (1515.84),
    // while the template uses computeInstallmentBreakdown's ROUND_DOWN (1515.83). Asserting
    // against c.installmentTotal directly would be off by 0.01 and prove nothing. (review)
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
        // audit_logs is IMMUTABLE — never deleted.
        await step(() => prisma.payment.deleteMany({ where: { contractId } }));
        await step(() => prisma.installmentSchedule.deleteMany({ where: { contractId } }));
        await step(() => prisma.contract.deleteMany({ where: { id: contractId } }));
      }
      // Outside the contractId guard: a beforeAll that created the FINANCE company
      // then threw before seeding the contract must still clean up the company. (review)
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
    expect(jeCount).toBe(3); // 3 receipt calls → 3 distinct receipt JEs (not consolidated)

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

  // ─── Phase 3 — legacy 2B interop cases (PR-843/I2 Phase 3) ──────────────────

  it(
    'legacy 2B partial → primitive completion: reconstructPrior counts prior partial, no double-clear (THE footgun)',
    async () => {
      await useInstallment(7);

      // Simulate a legacy partial-clear JE posted by the OLD non-split 2B template.
      // The OLD path posts metadata: { tag:'2B', contractId, installmentScheduleId, paymentId }
      // with NO partial/final flag. It credits 11-2103 by a partial amount < installmentTotal.
      await journal.createAndPost({
        description: 'legacy 2B partial (fixture)',
        reference: 'legacy-2b-partial-7',
        metadata: {
          tag: '2B',
          contractId,
          installmentScheduleId: instId,
          paymentId: 'fixture-7',
        },
        lines: [
          {
            accountCode: '11-1101',
            dr: new Decimal('800'),
            cr: new Decimal(0),
            description: 'cash',
          },
          {
            accountCode: '11-2103',
            dr: new Decimal(0),
            cr: new Decimal('800'),
            description: 'partial clear',
          },
        ],
      });

      // Now COMPLETE the installment via the primitive with the delta (installmentTotal − 800).
      // reconstructPrior must see priorPrincipalCleared = 800 so principalRemaining = installmentTotal − 800.
      const delta = installmentTotal.minus(800);
      const r = await template.execute({
        installmentScheduleId: instId,
        delta,
        debitAccountCode: '11-1101',
        isFinalReceipt: true,
      });

      // The primitive should clear ONLY the remaining delta, not the full installmentTotal.
      expect(r.split.principalCleared.toFixed(2)).toBe(delta.toFixed(2));
      expect(r.split.principalRemainingAfter.toFixed(2)).toBe('0.00');

      // Σ Cr 11-2103 across BOTH the legacy 2B JE + the new receipt JE must equal
      // installmentTotal exactly — every baht cleared once.
      expect((await sumCredits('11-2103')).toFixed(2)).toBe(installmentTotal.toFixed(2));
    },
    120_000,
  );

  it(
    'legacy 2B FULL-clear is excluded from reconstructPrior (discriminator guard)',
    async () => {
      await useInstallment(8);

      // Simulate a legacy FULL-clear 2B JE (credits exactly installmentTotal).
      // This must be EXCLUDED by reconstructPrior (full-clear = account is already settled,
      // no further primitive call should be needed; if one is, treat priorPrincipalCleared=0).
      await journal.createAndPost({
        description: 'legacy 2B full clear (fixture)',
        reference: 'legacy-2b-full-8',
        metadata: {
          tag: '2B',
          contractId,
          installmentScheduleId: instId,
          paymentId: 'fixture-8',
        },
        lines: [
          {
            accountCode: '11-1101',
            dr: installmentTotal,
            cr: new Decimal(0),
          },
          {
            accountCode: '11-2103',
            dr: new Decimal(0),
            cr: installmentTotal,
          },
        ],
      });

      // A later primitive receipt of 50 must treat priorPrincipalCleared as 0
      // (full-clear excluded), so principalRemaining = installmentTotal and 50 clears
      // cleanly without throwing "exceeds tolerance".
      const r = await template.execute({
        installmentScheduleId: instId,
        delta: new Decimal('50'),
        debitAccountCode: '11-1101',
      });
      expect(r.split.principalCleared.toFixed(2)).toBe('50.00');
      // NOTE: the Σ(Cr 11-2103) invariant deliberately does NOT hold in this degenerate
      // fixture (full-clear 1515.83 + a stray 50 = 1565.83); it is excluded on purpose —
      // the point of this case is only that the full-clear is NOT counted as prior.
    },
    120_000,
  );

  it(
    'legacy 2B partial + a caller re-sending the FULL amount → REJECTS (kills the missing-discriminator regression)',
    async () => {
      await useInstallment(9);

      // Legacy partial of 800 already cleared 11-2103 (old non-split 2B, partialClear).
      await journal.createAndPost({
        description: 'legacy 2B partial (fixture)',
        reference: 'legacy-2b-partial-9',
        metadata: { tag: '2B', contractId, installmentScheduleId: instId, paymentId: 'fixture-9' },
        lines: [
          { accountCode: '11-1101', dr: new Decimal('800'), cr: new Decimal(0) },
          { accountCode: '11-2103', dr: new Decimal(0), cr: new Decimal('800') },
        ],
      });

      // A caller mistakenly re-sends the FULL installmentTotal (not the 715.83 remaining delta).
      // WITH the discriminator: priorPrincipalCleared=800 → principalRemaining=715.83 →
      //   the extra 800 surfaces as overpayRounding > 1฿ → REJECT (no over-clear).
      // WITHOUT it (regression): priorPrincipalCleared=0 → clears the full 1515.83 AGAIN →
      //   Σ Cr 11-2103 = 800 + 1515.83 = 2315.83 silently, no throw. This case kills that mutation.
      await expect(
        template.execute({
          installmentScheduleId: instId,
          delta: installmentTotal,
          debitAccountCode: '11-1101',
          isFinalReceipt: true,
        }),
      ).rejects.toThrow(/exceeds tolerance/i);

      // The rejected call posts nothing — ledger still shows only the legacy 800.
      expect((await sumCredits('11-2103')).toFixed(2)).toBe('800.00');
    },
    120_000,
  );

  // ─── PR-843/I2 Phase 3 3a — adj_auto_route guard parity (ported from 2B) ─────

  it(
    'adj_auto_route=false → an overpay-rounding receipt REJECTS (manual adjustment required)',
    async () => {
      await useInstallment(10);

      // Turn the auto-route flag OFF for the duration of this case.
      await prisma.systemConfig.upsert({
        where: { key: 'adj_auto_route' },
        create: { key: 'adj_auto_route', value: 'false', label: 'e2e adj_auto_route' },
        update: { value: 'false', deletedAt: null },
      });

      try {
        // delta = installmentTotal + 0.50 with NO advanceCredit → 0.50 surfaces as
        // overpayRounding (≤1฿, within tolerance) → would normally route to 53-1503.
        // With the flag OFF the primitive must refuse and require a manual adjustment.
        await expect(
          template.execute({
            installmentScheduleId: instId,
            delta: installmentTotal.plus(new Decimal('0.50')),
            debitAccountCode: '11-1101',
            isFinalReceipt: true,
          }),
        ).rejects.toThrow(/Auto-routing disabled/i);

        // The rejected call posts nothing — no receipt JE for this installment.
        expect((await entryIdsForInstallment()).length).toBe(0);
        expect((await sumCredits('11-2103')).toFixed(2)).toBe('0.00');
      } finally {
        // Clean up the config row so it cannot leak into other suites / the dev DB.
        await prisma.systemConfig.deleteMany({ where: { key: 'adj_auto_route' } });
      }
    },
    120_000,
  );

  // ─── PR-843/I2 Phase 5b — autoApproveSystemRounding (the amountDue↔installmentTotal seam) ──
  //
  // The 2A last-installment true-up makes a Payment.amountDue differ from the
  // primitive's installmentTotal by up to N×0.01. When amountDue < installmentTotal,
  // a payment that fully covers the customer's BILLED obligation still leaves a ≤1฿
  // principal residual vs installmentTotal. On the final receipt the primitive sets
  // underpayRounding>0 and (pre-5b) REQUIRED a toleranceApproverId → the auto paths
  // (no approver) threw on a legitimate last-installment completion. The caller-set
  // `autoApproveSystemRounding` flag certifies this is a SYSTEM rounding residual
  // (full obligation paid), routing the ≤1฿ to 52-1104 WITHOUT an approver.

  it(
    'autoApproveSystemRounding=true: final underpay 0.01 with NO approver → Dr 52-1104 == 0.01, full clear, does NOT throw',
    async () => {
      await useInstallment(11);
      const r = await template.execute({
        installmentScheduleId: instId,
        delta: installmentTotal.minus(new Decimal('0.01')),
        debitAccountCode: '11-1101',
        isFinalReceipt: true,
        // No toleranceApproverId — the auto paths cannot approve. The flag waives
        // the approver REQUIREMENT for a certified system-rounding residual.
        autoApproveSystemRounding: true,
      });

      // The ≤1฿ underpay still posts to 52-1104; the receivable clears exactly.
      expect((await sumDebits('52-1104')).toFixed(2)).toBe('0.01');
      expect((await sumCredits('11-2103')).toFixed(2)).toBe(installmentTotal.toFixed(2));
      expect(r.split.principalRemainingAfter.toFixed(2)).toBe('0.00');
    },
    120_000,
  );

  it(
    'SIBLING (the control is preserved): SAME final underpay 0.01 WITHOUT the flag and WITHOUT an approver → STILL throws (genuine customer underpayment gate)',
    async () => {
      await useInstallment(12);
      await expect(
        template.execute({
          installmentScheduleId: instId,
          delta: installmentTotal.minus(new Decimal('0.01')),
          debitAccountCode: '11-1101',
          isFinalReceipt: true,
          // autoApproveSystemRounding omitted (false) AND no toleranceApproverId →
          // the approver requirement stands for a genuine ≤1฿ customer underpayment.
        }),
      ).rejects.toThrow(/Underpay tolerance requires approver/i);

      // The rejected call posts nothing — no receipt JE for this installment.
      expect((await entryIdsForInstallment()).length).toBe(0);
      expect((await sumCredits('11-2103')).toFixed(2)).toBe('0.00');
    },
    120_000,
  );
});
