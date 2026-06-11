import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { computeInstallmentBreakdown } from '../compute-installment-breakdown';
// EIR utility removed — CPA Policy A revert (#783) reverted to straight-line allocation.

/**
 * Template 2A — Installment Accrual (fires on each installment due date).
 *
 * Spec §6.2 — recognizes each installment as it comes due:
 *
 *   Dr 11-2103 ลูกหนี้ค้างชำระ          (installmentTotal = installmentExclVat + vatPerInst)
 *   Dr 21-2102 ล้างภาษีขายรอเรียกเก็บ   (vatPerInst)
 *   Dr 11-2106 ล้างรายได้รอตัดบัญชี      (interestPerInst)
 *     Cr 11-2101 ลูกหนี้ Gross (ลด)       (installmentExclVat)
 *     Cr 11-2105 ลูกหนี้ภาษีขายรอฯ (ล้าง) (vatPerInst)
 *     Cr 41-1101 รายได้ดอกเบี้ย (รับรู้)   (interestPerInst)
 *     Cr 21-2101 ภาษีขาย ภ.พ.30           (vatPerInst)
 *
 * Interest recognition: EIR (Effective Interest Method) per TFRS 15 §60-65.
 *   - Period 1: highest interest (= openingPrincipal × monthlyEIR)
 *   - Period N: lowest interest (snap to clear residual)
 *   - Total interest = interestTotal (matches contract)
 *
 * Updated from straight-line allocation (Wave 4 / Option B / Phase 2 EIR migration).
 *
 * Rounding modes:
 *   installmentExclVat = grossExclVat / totalMonths → ROUND_DOWN  (17000/12 = 1416.66)
 *   vatPerInst         = vatTotal / totalMonths     → ROUND_HALF_UP (1190/12 = 99.17)
 *   interestPerInst    = interest / totalMonths     → ROUND_HALF_UP straight-line (CPA Policy A · #783)
 *
 * Recognition policy:
 *   - TFRS 15 §35(b): performance obligation satisfied "over time" — financing
 *     service is consumed by the customer through each due date, so revenue is
 *     recognised per period (this template, fired daily by accrual cron).
 *   - VAT recognition: deferred VAT (21-2102 booked at contract activation) is
 *     reclassified to settled VAT (21-2101) per period — matches TFRS 15
 *     pattern of recognising tax liability when service is performed.
 *
 * Recognition policy (Wave 4 / Task 2 — Info comments):
 *   - TFRS 15 §35(b): performance obligation satisfied "over time" — financing
 *     service is consumed by the customer through each due date, so revenue is
 *     recognised per period (this template, fired daily by accrual cron).
 *   - Interest recognition: straight-line allocation per period (NPAEs simplification
 *     per W-003 in CLAUDE.md). NOT effective interest method (EIR).
 *     Material deviation from EIR documented in audit report; owner+CPA approved
 *     NPAEs simplification (target adoption date TBD).
 *   - VAT recognition: deferred VAT (21-2102 booked at contract activation) is
 *     reclassified to settled VAT (21-2101) per period — matches TFRS 15
 *     pattern of recognising tax liability when service is performed.
 *
 * Idempotent: returns null if accrualJournalEntryId is already set on the installment.
 */
@Injectable()
export class InstallmentAccrual2ATemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    installmentScheduleId: string,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string } | null> {
    // Fast idempotency check outside the transaction (avoids opening a tx for
    // already-accrued installments — the common case on repeated cron ticks).
    const instCheck = await this.prisma.installmentSchedule.findUniqueOrThrow({
      where: { id: installmentScheduleId },
      select: { accrualJournalEntryId: true },
    });
    if (instCheck.accrualJournalEntryId) return null;

    if (outerTx) {
      return this.run(installmentScheduleId, outerTx);
    }
    // No outer tx — self-wrap so the JE post + accrualJournalEntryId stamp +
    // advance-consume JE + contract/payment updates are one atomic unit.
    // A crash between any of these steps can no longer produce a duplicate
    // accrual JE on the next cron tick (the idempotency stamp is committed
    // atomically with the JE).
    //
    // Serializable isolation: the advance-consume leg reads contract.advanceBalance
    // then decrements it. The payment paths (PaySolutions webhook, recordPayment) also
    // decrement advanceBalance under Serializable — without matching isolation here a
    // concurrent accrual + payment could both read the same balance and double-consume.
    // On a serialization conflict the cron's per-installment try/catch retries next tick
    // (idempotent — accrualJournalEntryId is not stamped on a rolled-back tx).
    return this.prisma.$transaction((tx) => this.run(installmentScheduleId, tx), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  private async run(
    installmentScheduleId: string,
    tx: Prisma.TransactionClient,
  ): Promise<{ entryNo: string } | null> {
    const inst = await tx.installmentSchedule.findUniqueOrThrow({
      where: { id: installmentScheduleId },
    });

    // Idempotency guard (re-check inside tx in case two concurrent cron ticks
    // both passed the outer fast-check before either committed).
    if (inst.accrualJournalEntryId) return null;

    const c = await tx.contract.findUniqueOrThrow({ where: { id: inst.contractId } });

    // Per-installment amounts via the shared single source of truth — same
    // rounding the 2B receipt / early-payoff use (ROUND_DOWN principal,
    // ROUND_HALF_UP interest+VAT). Straight-line per CPA Policy A (post-#783).
    const base = computeInstallmentBreakdown({
      financedAmount: c.financedAmount.toString(),
      storeCommission: c.storeCommission != null ? c.storeCommission.toString() : null,
      interestTotal: c.interestTotal.toString(),
      vatAmount: c.vatAmount != null ? c.vatAmount.toString() : null,
      totalMonths: c.totalMonths,
    });
    let installmentExclVat = base.installmentExclVat; // 1,416.66
    let interestPerInst = base.interestPerInst; //       500.00
    let vatPerInst = base.vatPerInst; //                  99.17

    // Final-period residual adjustment (Wave 1 / Task 6 — Audit P0 TFRS 15 C-1).
    // ROUND_DOWN/ROUND_HALF_UP per-installment rounding can leak residuals
    // (e.g. 1416.66 × 12 = 16,999.92 vs target 17,000.00). On the LAST
    // installment we absorb whatever remains so 11-2101 / 11-2105 / 41-1101
    // hit exactly 0 after the cycle completes.
    if (inst.installmentNo === c.totalMonths) {
      const priorPeriods = new Decimal(c.totalMonths - 1);
      installmentExclVat = base.grossExclVat.minus(installmentExclVat.times(priorPeriods));
      vatPerInst = base.vat.minus(vatPerInst.times(priorPeriods));
      interestPerInst = new Decimal(c.interestTotal.toString()).minus(
        interestPerInst.times(priorPeriods),
      );
    }

    const installmentTotal = installmentExclVat.plus(vatPerInst); // 1,515.83

    const zero = new Decimal(0);

    const result = await this.journal.createAndPost(
      {
      description: `Accrual งวด #${inst.installmentNo} — สัญญา ${c.contractNumber}`,
      reference: inst.id,
      metadata: { tag: '2A', contractId: c.id, installmentScheduleId: inst.id },
      postedAt: inst.dueDate,
      lines: [
        {
          accountCode: '11-2103',
          dr: installmentTotal,
          cr: zero,
          description: 'ลูกหนี้ค้างชำระ (Accrual)',
        },
        {
          accountCode: '21-2102',
          dr: vatPerInst,
          cr: zero,
          description: 'ล้าง ภาษีขายรอเรียกเก็บ',
        },
        {
          accountCode: '11-2106',
          dr: interestPerInst,
          cr: zero,
          description: 'ล้าง รายได้รอตัดบัญชี-ดอกเบี้ย',
        },
        {
          accountCode: '11-2101',
          dr: zero,
          cr: installmentExclVat,
          description: 'ลูกหนี้ Gross (ลด excl.VAT)',
        },
        {
          accountCode: '11-2105',
          dr: zero,
          cr: vatPerInst,
          description: 'ลูกหนี้ภาษีขายรอฯ (ล้าง)',
        },
        {
          accountCode: '41-1101',
          dr: zero,
          cr: interestPerInst,
          description: 'รายได้ดอกเบี้ย (รับรู้)',
        },
        {
          accountCode: '21-2101',
          dr: zero,
          cr: vatPerInst,
          description: 'ภาษีขาย ภ.พ.30',
        },
      ],
      },
      tx,
    );

    // Mark installment as accrued (idempotency)
    await tx.installmentSchedule.update({
      where: { id: inst.id },
      data: { accrualJournalEntryId: result.entryNumber },
    });

    // CPA Policy A — Auto-consume advance balance on accrual.
    //
    // If the contract has an advance parked in 21-1103 (from a payment
    // posted before this installment's due date — see PaymentReceipt2B
    // `advanceCredit` flow), immediately clear up to installmentTotal
    // inside the same tx. Otherwise the trial balance shows both the
    // freshly-accrued 11-2103 receivable AND the advance liability
    // sitting alongside each other until the next 2B receipt fires —
    // which only happens if the customer pays again. Auto-clearing here
    // keeps the books accurate without requiring a redundant manual
    // payment touch.
    //
    // JE: Dr 21-1103 (consume advance) / Cr 11-2103 (clear receivable)
    //   for amount = min(advanceBalance, installmentTotal).
    //
    // Atomicity: posted in the same tx as the accrual JE + schedule update,
    // so a JE-post failure rolls everything back — no partially-consumed
    // advance with the receivable still showing.
    const advanceBalance = new Decimal(c.advanceBalance.toString());
    if (advanceBalance.gt(0)) {
      const consume = Decimal.min(advanceBalance, installmentTotal);

      await this.journal.createAndPost(
        {
          description: `หักเงินรับล่วงหน้าเข้างวด #${inst.installmentNo} — สัญญา ${c.contractNumber}`,
          reference: `${inst.id}:advance-consume-on-accrual`,
          metadata: {
            tag: '2B',
            flow: 'advance-consume-on-accrual',
            contractId: c.id,
            installmentScheduleId: inst.id,
            installmentNo: inst.installmentNo,
            consumeAmount: consume.toFixed(2),
          },
          postedAt: inst.dueDate,
          lines: [
            {
              accountCode: '21-1103',
              dr: consume,
              cr: zero,
              description: 'หักเงินรับล่วงหน้าเข้างวด',
            },
            {
              accountCode: '11-2103',
              dr: zero,
              cr: consume,
              description: 'ล้างลูกหนี้ค้างชำระ (จาก advance)',
            },
          ],
        },
        tx,
      );

      // Decrement contract's parked advance balance by the consumed amount.
      await tx.contract.update({
        where: { id: c.id },
        data: { advanceBalance: { decrement: consume } },
      });

      // Reflect the consume on the existing Payment row (if one was
      // pre-created when the advance was first received). Fully covered
      // installments flip to PAID; partial covers stay PARTIALLY_PAID.
      const payment = await tx.payment.findFirst({
        where: {
          contractId: c.id,
          installmentNo: inst.installmentNo,
          deletedAt: null,
        },
        select: { id: true, amountDue: true, amountPaid: true },
      });
      if (payment) {
        const newAmountPaid = new Decimal(payment.amountPaid.toString()).plus(consume);
        const due = new Decimal((payment.amountDue ?? installmentTotal).toString());
        const isPaidInFull = newAmountPaid.gte(due);
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            amountPaid: newAmountPaid,
            status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
            paidDate: isPaidInFull ? new Date() : null,
            paidAt: isPaidInFull ? new Date() : null,
          },
        });
      } else {
        // No Payment row at accrual time. The advance-consume JE still posts
        // correctly (Dr 21-1103 / Cr 11-2103) — but the Payment row's amountPaid
        // stays at its prior value (0 when the row is created later). That timing
        // window makes FINAL-REVIEW BLOCKER 1 reachable: a subsequent receipt fired
        // against that 0-amountPaid Payment would re-clear an installment the
        // advance already cleared. Alert ops to backfill the Payment row so it
        // reflects the consume. Do NOT throw — that would break the accrual cron.
        Sentry.captureMessage('Advance consumed on accrual with no Payment row to update', {
          level: 'error',
          tags: {
            module: 'journal',
            action: 'advance-consume-no-payment-row',
          },
          extra: {
            contractId: c.id,
            contractNumber: c.contractNumber,
            installmentScheduleId: inst.id,
            installmentNo: inst.installmentNo,
            consume: consume.toFixed(2),
          },
        });
      }
    }

    return { entryNo: result.entryNumber };
  }
}
