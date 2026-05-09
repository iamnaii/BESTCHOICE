import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

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
 * Total Dr = installmentTotal + vatPerInst + interestPerInst = 2,115.00
 * Total Cr = installmentExclVat + vatPerInst + interestPerInst + vatPerInst = 2,115.00 ✓
 *
 * Rounding modes (per CSV spec):
 *   installmentExclVat = grossExclVat / totalMonths → ROUND_DOWN  (17000/12 = 1416.66)
 *   vatPerInst         = vatTotal / totalMonths     → ROUND_HALF_UP (1190/12 = 99.17)
 *   interestPerInst    = interestTotal / totalMonths → ROUND_HALF_UP (6000/12 = 500.00 exact)
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
    tx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string } | null> {
    const client = tx ?? this.prisma;
    const inst = await client.installmentSchedule.findUniqueOrThrow({
      where: { id: installmentScheduleId },
    });

    // Idempotency guard
    if (inst.accrualJournalEntryId) return null;

    const c = await client.contract.findUniqueOrThrow({ where: { id: inst.contractId } });

    const total = new Decimal(c.totalMonths);
    const financed = new Decimal(c.financedAmount.toString());
    const commission =
      c.storeCommission != null
        ? new Decimal(c.storeCommission.toString())
        : financed.times('0.10').toDecimalPlaces(2);
    const interest = new Decimal(c.interestTotal.toString());
    const grossExclVat = financed.plus(commission).plus(interest);
    const vat =
      c.vatAmount != null
        ? new Decimal(c.vatAmount.toString())
        : grossExclVat.times('0.07').toDecimalPlaces(2);

    // Per-installment amounts — rounding modes match CSV spec
    let installmentExclVat = grossExclVat.div(total).toDecimalPlaces(2, Decimal.ROUND_DOWN); // 1,416.66
    let interestPerInst = interest.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP); //   500.00
    let vatPerInst = vat.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP); //    99.17

    // Final-period residual adjustment (Wave 1 / Task 6 — Audit P0 TFRS 15 C-1).
    // ROUND_DOWN/ROUND_HALF_UP per-installment rounding can leak residuals
    // (e.g. 1416.66 × 12 = 16,999.92 vs target 17,000.00). On the LAST
    // installment we absorb whatever remains so 11-2101 / 11-2105 / 41-1101
    // hit exactly 0 after the cycle completes.
    if (inst.installmentNo === c.totalMonths) {
      const priorPeriods = new Decimal(c.totalMonths - 1);
      const priorExclVat = installmentExclVat.times(priorPeriods);
      const priorVat = vatPerInst.times(priorPeriods);
      const priorInterest = interestPerInst.times(priorPeriods);
      installmentExclVat = grossExclVat.minus(priorExclVat);
      vatPerInst = vat.minus(priorVat);
      interestPerInst = interest.minus(priorInterest);
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
    await client.installmentSchedule.update({
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
    // Atomicity: posted in the same outer tx as the accrual JE +
    // schedule update, so a JE-post failure rolls everything back —
    // no partially-consumed advance with the receivable still showing.
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
      await client.contract.update({
        where: { id: c.id },
        data: { advanceBalance: { decrement: consume } },
      });

      // Reflect the consume on the existing Payment row (if one was
      // pre-created when the advance was first received). Fully covered
      // installments flip to PAID; partial covers stay PARTIALLY_PAID.
      const payment = await client.payment.findFirst({
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
        await client.payment.update({
          where: { id: payment.id },
          data: {
            amountPaid: newAmountPaid,
            status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
            paidDate: isPaidInFull ? new Date() : null,
            paidAt: isPaidInFull ? new Date() : null,
          },
        });
      }
    }

    return { entryNo: result.entryNumber };
  }
}
