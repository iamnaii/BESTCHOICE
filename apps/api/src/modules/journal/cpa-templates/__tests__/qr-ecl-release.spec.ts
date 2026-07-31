import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from '../contract-activation-1a.template';
import { BadDebtProvisionTemplate } from '../bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from '../bad-debt-writeoff.template';
import { EclStageReverseTemplate } from '../ecl-stage-reverse.template';
import { PaymentReceiptTemplate } from '../payment-receipt.template';
import { JournalAutoService } from '../../journal-auto.service';
import { glContractBalance } from '../../gl-contract-balance';
import { BadDebtService } from '../../../accounting/bad-debt.service';
import { ConsecutiveMissedService } from '../../../overdue/consecutive-missed.service';

/**
 * QR-ECL-release (follow-up to C1 / PR #1384, owner decision 2026-07-30).
 *
 * C1 fixed `ContractPaymentService.earlyPayoff` (JP4 — cashier "ปิดยอดก่อนกำหนด")
 * to release the contract's 11-2102 ECL allowance on close. This same bug
 * existed on the PaySolutions QR webhook path: `PaySolutionsWebhookService.
 * handlePaymentCallback` posts installment receipts via
 * `PaymentReceiptTemplate.execute(...)` and NEVER called
 * `BadDebtService.reverseStageOnPayment` — so a QR payment that CLOSED a
 * contract (EARLY_PAYOFF/COMPLETED) left any ACTIVE `BadDebtProvision` row +
 * its GL 11-2102 balance stuck forever, same failure class as C1, once the
 * contract exits the daily cron's scope (ACTIVE/OVERDUE/DEFAULT/TERMINATED
 * only).
 *
 * Fix: the webhook now calls `badDebtService.reverseStageOnPayment(contractId,
 * tx)` ONCE per contract, inside the SAME Serializable tx, right after all of
 * that webhook's touched installments have posted their receipt JEs — the
 * exact call shape asserted here. Unlike C1's JP4 fix (a bespoke
 * `releaseEclOnPayoff` helper calling `EclStageReverseTemplate` directly),
 * this wire reuses `reverseStageOnPayment` itself — the SAME real-time hook
 * `payment-receipt-orchestrator.ts` already calls after the cashier
 * recordPayment path. `reverseStageOnPayment` computes target=0 once no
 * installments remain outstanding, which routes through its shared
 * `fullReverseProvision` helper (Dr 11-2102 / Cr 51-1103 + row REVERSED) —
 * the same release primitive C1 uses, just reached generically instead of a
 * payoff-specific path. ONE wire covers both the partial step-down case and
 * the full-closure case.
 *
 * This spec drives `BadDebtService.reverseStageOnPayment` with the EXACT
 * call shape the webhook now uses (contractId, tx) after simulating the
 * webhook's own receipt-posting for every installment (via the same
 * `PaymentReceiptTemplate` primitive the webhook calls) — proving the
 * production call wires into a real DB and produces the expected JE. The
 * wiring itself (that the webhook actually calls this, once per contract,
 * with proper error-isolation) is pinned by the jest unit specs in
 * apps/api/src/modules/paysolutions/paysolutions.service.spec.ts and
 * paysolutions.callback-money.spec.ts.
 *
 * Runner: vitest (DB-backed; *.spec.ts under cpa-templates/__tests__/ is
 * covered by the deploy-gcp.yml CI glob).
 *
 * Golden (17k/12m fixture, installmentTotal 1,515.83): a pre-existing 30.32
 * provision (B1 bucket, 2%) seeded via a real `BadDebtProvisionTemplate` JE +
 * matching ACTIVE `BadDebtProvision` row → after every installment is paid in
 * full (simulating a QR webhook that closed the contract), calling
 * reverseStageOnPayment must post Dr 11-2102 30.32 / Cr 51-1103 30.32, leave
 * GL 11-2102 for the contract at exactly 0.00, and flip the row to REVERSED.
 */

const prisma = new PrismaClient();

function buildBadDebtService(journal: JournalAutoService): BadDebtService {
  return new BadDebtService(
    prisma as any,
    journal,
    new BadDebtProvisionTemplate(journal, prisma as any),
    new BadDebtWriteOffTemplate(journal, prisma as any),
    new EclStageReverseTemplate(journal, prisma as any),
    new ConsecutiveMissedService(prisma as any),
    undefined as any, // CreditNoteDocumentService — unused (this spec never calls writeOffBadDebt)
    undefined as any, // CreditNoteDeliveryService — unused (this spec never calls writeOffBadDebt)
  );
}

async function setup(): Promise<{ journal: JournalAutoService; adminId: string }> {
  // JournalPostAuditLog rows (asset flows) FK-reference journal_entries —
  // clear them BEFORE journalEntry or deleteMany trips P2003 (same cleanup
  // convention as jp4-ecl-release.spec.ts / ecl-terminated-base.spec.ts).
  await prisma.journalPostAuditLog.deleteMany({});
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.badDebtProvision.deleteMany({});
  await prisma.receipt.deleteMany({});
  await prisma.eDocument.deleteMany({});
  await prisma.signature.deleteMany({});
  await prisma.contractDocument.deleteMany({});
  await prisma.partialPaymentLink.deleteMany({});
  await prisma.warrantyAuditLog.deleteMany({});
  await prisma.promiseSlot.deleteMany({});
  await prisma.callLog.deleteMany({});
  await prisma.dunningAction.deleteMany({});
  await prisma.repossession.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  await prisma.payment.deleteMany({});
  // T1-C7 guard: a contract that went through a real writeOffBadDebt() has a
  // permanent (DB-trigger-immutable) badDebtWriteOffAuditLog row FK-referencing
  // it (see cn-issue-on-writeoff.spec.ts, Phase 3 Task 3) — an unscoped
  // deleteMany would throw once one exists in this shared dev/CI DB.
  const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
  await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
  await seedFinanceCoa(prisma);

  const existingFinance = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
  if (!existingFinance) {
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

  let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!admin) {
    admin = await prisma.user.create({
      data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });
  }

  return { journal: new JournalAutoService(prisma as any), adminId: admin.id };
}

async function getStageReverseEntries(contractId: string) {
  return prisma.journalEntry.findMany({
    where: {
      AND: [
        { metadata: { path: ['contractId'], equals: contractId } } as any,
        { metadata: { path: ['flow'], equals: 'stage-reverse' } } as any,
      ],
    },
    include: { lines: true },
  });
}

describe('QR webhook close releases 11-2102 ECL allowance via reverseStageOnPayment (follow-up to C1, 2026-07-30)', () => {
  let contractId: string;

  beforeAll(async () => {
    const { journal } = await setup();

    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await new ContractActivation1ATemplate(journal, prisma as any).execute(contractId);

    // Seed a POSTED provision JE 30.32 (Dr 51-1103 / Cr 11-2102) — a real prior
    // monthly-close run, same convention as jp4-ecl-release.spec.ts.
    const provisionTmpl = new BadDebtProvisionTemplate(journal, prisma as any);
    await provisionTmpl.execute({
      contractId,
      provisionAmount: new Decimal('30.32'),
      period: '2025-02',
    });

    // Matching ACTIVE BadDebtProvision row (30d overdue, B1 bucket 2%).
    await prisma.badDebtProvision.create({
      data: {
        contractId,
        provisionDate: new Date(),
        agingBucket: '1-30',
        daysOverdue: 30,
        outstandingAmount: new Decimal('1515.83'),
        provisionRate: new Decimal('0.02'),
        provisionAmount: new Decimal('30.32'),
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    // Scoped to this spec's own contractId — do NOT touch journal_entries/
    // journal_lines unscoped (shared across specs; each spec's own setup()
    // wipe already guarantees a clean slate — see sibling specs' convention).
    await prisma.badDebtProvision.deleteMany({ where: { contractId } });
    await prisma.payment.deleteMany({ where: { contractId } });
    await prisma.installmentSchedule.deleteMany({ where: { contractId } });
    await prisma.contract.deleteMany({ where: { id: contractId } });
    await prisma.$disconnect();
  });

  it('sanity: GL 11-2102 balance for the contract is 30.32 BEFORE the QR close', async () => {
    const bal = await glContractBalance(prisma, contractId, '11-2102', 'cr');
    expect(bal.toFixed(2)).toBe('30.32');
  });

  it('simulated QR webhook closes all 12 installments, then reverseStageOnPayment(contractId, tx) releases the 30.32 allowance (Dr 11-2102 / Cr 51-1103), GL nets to 0.00, row REVERSED', async () => {
    const journal = new JournalAutoService(prisma as any);
    const badDebtService = buildBadDebtService(journal);
    const receiptTemplate = new PaymentReceiptTemplate(journal, prisma as any);

    const schedules = await prisma.installmentSchedule.findMany({
      where: { contractId },
      orderBy: { installmentNo: 'asc' },
    });
    expect(schedules.length).toBe(12);

    // Golden per-installment total for the 17k/12m fixture (see
    // scenario-helpers.ts / jp4-ecl-release.spec.ts's seedPendingPayments).
    const installmentTotal = new Decimal('1515.83');

    // Mirrors PaySolutionsWebhookService.handlePaymentCallback's Serializable
    // tx: FIFO-close every installment via tx.payment.update + the SAME
    // PaymentReceiptTemplate primitive the webhook calls, THEN — ONCE per
    // contract, not per installment — call reverseStageOnPayment(contractId,
    // tx) with the exact call shape the fix wires into the webhook.
    await prisma.$transaction(async (tx) => {
      for (const sched of schedules) {
        await tx.payment.create({
          data: {
            contractId,
            installmentNo: sched.installmentNo,
            dueDate: sched.dueDate,
            amountDue: installmentTotal,
            amountPaid: installmentTotal,
            paidDate: new Date(),
            paidAt: new Date(),
            status: 'PAID',
          },
        });
        await receiptTemplate.execute(
          {
            installmentScheduleId: sched.id,
            delta: installmentTotal,
            debitAccountCode: '11-1202',
            isFinalReceipt: true,
            autoApproveSystemRounding: true,
          },
          tx,
        );
      }

      await tx.contract.update({
        where: { id: contractId },
        data: { status: 'EARLY_PAYOFF', creditBalance: 0 },
      });

      await badDebtService.reverseStageOnPayment(contractId, tx);
    });

    // Exactly ONE ECL-stage-reverse JE posted for this contract.
    const entries = await getStageReverseEntries(contractId);
    expect(entries.length, 'expected exactly 1 ECL stage-reverse JE').toBe(1);

    const lines = entries[0].lines;
    const dr112102 = lines
      .filter((l) => l.accountCode === '11-2102')
      .reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const cr511103 = lines
      .filter((l) => l.accountCode === '51-1103')
      .reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(dr112102.toFixed(2)).toBe('30.32');
    expect(cr511103.toFixed(2)).toBe('30.32');

    // JE balanced.
    const totalDr = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    // GL 11-2102 for this contract now nets to exactly 0.00.
    const balAfter = await glContractBalance(prisma, contractId, '11-2102', 'cr');
    expect(balAfter.toFixed(2)).toBe('0.00');

    // BadDebtProvision row flipped to REVERSED.
    const row = await prisma.badDebtProvision.findFirst({ where: { contractId } });
    expect(row!.status).toBe('REVERSED');

    // Contract really did close, matching the webhook's own contract-close
    // decision for >1 installment paid in one call (EARLY_PAYOFF).
    const contract = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(contract!.status).toBe('EARLY_PAYOFF');
  });
});
