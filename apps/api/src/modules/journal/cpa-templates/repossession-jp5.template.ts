import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface RepossessionInput {
  contractId: string;
  depositAccountCode: string;
  /** Fair market value of repossessed device (amount received from customer) */
  repossessionValue: Decimal;
}

/**
 * Template JP5 — Repossession (Case 5).
 *
 * Spec §6.5 — close out remaining installments on device repossession.
 *
 * VAT Split (Wave 1 / Task 7) — ป.รัษฎากร ม.82/3 + ประกาศ 36/2536 ข้อ 3:
 *   Each installment's VAT triggers ความรับผิด only ONCE. JP5 must inspect
 *   InstallmentSchedule.accrualJournalEntryId per installment and split:
 *
 *   Accrued (2A already ran — receivable parked at 11-2103):
 *     Dr depositAccountCode           (cash leg, shared)
 *     Dr 21-2101 (credit note VAT)    vatPerInst × accruedCount  [Wave 2 / Task 2]
 *     Cr 11-2103 ลูกหนี้ค้างชำระ         installmentTotal × accruedCount
 *     (No 11-2105/11-2106/21-2102/41-1101 — already settled by 2A.
 *      Income (41-1101) NOT reversed — customer used the goods, income properly earned;
 *      uncollectable portion flows to 51-1102 bad debt loss below.)
 *
 * Credit Note for accrued VAT (Wave 2 / Task 2) — ป.รัษฎากร ม.82/5 + ประกาศ 36/2536 ข้อ 2(6):
 *   ตอนยึดเครื่อง ส่วน VAT ที่นำส่งไปแล้ว (settled at 21-2101 by 2A) ต้องออกใบลดหนี้
 *   (credit note) ภายใน 30 วัน → Dr 21-2101 reduces VAT liability.
 *   Net effect on JE balance: 51-1102 loss reduces by exactly the credit note amount
 *   (VAT recovered via credit note is NOT a loss — it offsets receivable derecognized).
 *
 *   Deferred (2A not run — receivable still at 11-2101/11-2105/11-2106):
 *     Dr 11-2106 รายได้รอตัดบัญชี-ดอกเบี้ย  deferredInterest
 *     Dr 21-2102 ล้างภาษีขายรอเรียกเก็บ      deferredVat
 *       Cr 11-2101 ลูกหนี้ Gross              deferredGross
 *       Cr 11-2105 ลูกหนี้ภาษีขายรอฯ          deferredVat
 *       Cr 21-2101 ภาษีขาย ภ.พ.30            deferredVat
 *       Cr 41-1101 รายได้ดอกเบี้ย             deferredInterest
 *
 * Loss / Gain (computed against TOTAL receivable being derecognized):
 *   remainingTotal = accruedTotal + deferredGross + deferredVat - accruedCreditNoteVat
 *   loss = remainingTotal - repossessionValue   → Dr 51-1102 (when > 0)
 *   gain = repossessionValue - remainingTotal   → Cr 41-1102 (when > 0)
 *   (Credit note VAT subtracted because it's recovered via Dr 21-2101 — not a P&L loss)
 *
 * Calculations (per-installment, consistent rounding with 2A/2B):
 *   installmentExclVat = grossExclVat / totalMonths  (ROUND_DOWN)
 *   interestPerInst    = interestTotal / totalMonths  (ROUND_HALF_UP)
 *   vatPerInst         = vatTotal / totalMonths       (ROUND_HALF_UP)
 *   installmentTotal   = installmentExclVat + vatPerInst
 */
@Injectable()
export class RepossessionJP5Template {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: RepossessionInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const client = tx ?? this.prisma;
    const c = await client.contract.findUniqueOrThrow({ where: { id: input.contractId } });

    // Determine unpaid installments via Payment table (no status field on InstallmentSchedule)
    const allInsts = await client.installmentSchedule.findMany({
      where: { contractId: c.id, deletedAt: null },
      orderBy: { installmentNo: 'asc' },
    });
    const paidPayments = await client.payment.findMany({
      where: { contractId: c.id, status: 'PAID' },
      select: { installmentNo: true },
    });
    const paidNos = new Set(paidPayments.map((p) => p.installmentNo));
    const unpaidInsts = allInsts.filter((i) => !paidNos.has(i.installmentNo));
    const unpaid = unpaidInsts.length;

    if (unpaid === 0) {
      throw new Error('No unpaid installments — nothing to repossess');
    }

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

    // Per-installment rounding (same as 2A/2B)
    const installmentExclVat = grossExclVat.div(total).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const interestPerInst = interest.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const vatPerInst = vat.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const installmentTotal = installmentExclVat.plus(vatPerInst);

    // VAT split: ป.รัษฎากร ม.82/3 — VAT แต่ละงวดเกิดความรับผิดเพียง 1 ครั้ง.
    // Accrued installments (2A run) already credited 21-2101 / 11-2105 / 41-1101
    // and debited 11-2106 / 21-2102, parking the receivable at 11-2103.
    // Deferred installments still hold their balances at the original 1A locations.
    const accruedInsts = unpaidInsts.filter((i) => i.accrualJournalEntryId !== null);
    const deferredInsts = unpaidInsts.filter((i) => i.accrualJournalEntryId === null);
    const accruedCount = new Decimal(accruedInsts.length);
    const deferredCount = new Decimal(deferredInsts.length);

    // Accrued portion — only 11-2103 needs clearing (offset of 2A's Dr 11-2103)
    const accruedClear11_2103 = installmentTotal.times(accruedCount);

    // Wave 2 T2 — Credit note VAT for accrued installments (per ม.82/5)
    // Recovers settled VAT (21-2101) → reduces both VAT liability and loss recognition
    const accruedCreditNoteVat = vatPerInst.times(accruedCount);

    // Deferred portion — full original clearance / VAT settlement
    const deferredGross = installmentExclVat.times(deferredCount);
    const deferredVat = vatPerInst.times(deferredCount);
    const deferredInterest = interestPerInst.times(deferredCount);

    // Total receivable being derecognized (drives loss/gain calc)
    // Wave 2 T2: subtract accrued VAT recovered via credit note (Dr 21-2101) — not a loss.
    const remainingTotal = accruedClear11_2103
      .plus(deferredGross)
      .plus(deferredVat)
      .minus(accruedCreditNoteVat);

    // lossOrGain: positive = loss (remainingTotal > repoValue), negative = gain
    const lossOrGain = remainingTotal.minus(input.repossessionValue);

    const zero = new Decimal(0);

    const lines: { accountCode: string; dr: Decimal; cr: Decimal; description?: string }[] = [
      {
        accountCode: input.depositAccountCode,
        dr: input.repossessionValue,
        cr: zero,
        description: `ราคากลางเครื่อง ${input.repossessionValue.toFixed(2)} ฿`,
      },
    ];

    // Accrued path — Cr 11-2103 only (VAT already settled by 2A; do not Cr 21-2101 again)
    // Wave 2 Task 2: also issue credit note (Dr 21-2101) per ม.82/5 — reverses settled VAT
    if (accruedCount.gt(0)) {
      lines.push({
        accountCode: '21-2101',
        dr: accruedCreditNoteVat,
        cr: zero,
        description: `ใบลดหนี้ VAT ${accruedInsts.length} งวด (ม.82/5)`,
      });
      lines.push({
        accountCode: '11-2103',
        dr: zero,
        cr: accruedClear11_2103,
        description: `ล้างลูกหนี้ค้างชำระ ${accruedInsts.length} งวด (accrued)`,
      });
    }

    // Deferred path — full clearance + VAT settlement (move 21-2102 → 21-2101)
    if (deferredCount.gt(0)) {
      lines.push(
        {
          accountCode: '11-2106',
          dr: deferredInterest,
          cr: zero,
          description: 'ยกเลิกรายได้รอตัดบัญชี-ดอกเบี้ย',
        },
        {
          accountCode: '21-2102',
          dr: deferredVat,
          cr: zero,
          description: 'ล้างภาษีขายรอเรียกเก็บ',
        },
        {
          accountCode: '11-2101',
          dr: zero,
          cr: deferredGross,
          description: 'ล้างลูกหนี้ Gross (excl. VAT)',
        },
        {
          accountCode: '11-2105',
          dr: zero,
          cr: deferredVat,
          description: 'ล้างลูกหนี้ภาษีขายรอฯ',
        },
        {
          accountCode: '21-2101',
          dr: zero,
          cr: deferredVat,
          description: `ภาษีขาย ภ.พ.30 ถึงกำหนด (${deferredInsts.length} งวด deferred)`,
        },
        {
          accountCode: '41-1101',
          dr: zero,
          cr: deferredInterest,
          description: 'รับรู้รายได้ดอกเบี้ย',
        },
      );
    }

    if (lossOrGain.gt(0)) {
      // Loss case — TFRS §B61-B63 + TAS 36: consume any existing
      // Bad Debt provision (11-2102 contra asset) before recognizing
      // loss to 51-1102. Otherwise loss is double-counted (once via the
      // provision expense in a prior period, once via repo loss now).
      //
      // provisionBalance = sum(Cr 11-2102) - sum(Dr 11-2102) for this contractId
      // (only POSTED entries; deletedAt-null implicit via journalLine relation)
      const provisionLines = await client.journalLine.findMany({
        where: {
          accountCode: '11-2102',
          journalEntry: {
            metadata: { path: ['contractId'], equals: c.id },
            status: 'POSTED',
            deletedAt: null,
          },
        },
        select: { debit: true, credit: true },
      });
      const provisionBalance = provisionLines.reduce(
        (sum, l) => sum.plus(new Decimal(l.credit.toString())).minus(new Decimal(l.debit.toString())),
        new Decimal(0),
      );

      let remainingLoss = lossOrGain;

      if (provisionBalance.gt(0)) {
        const consume = Decimal.min(remainingLoss, provisionBalance);
        lines.push({
          accountCode: '11-2102',
          dr: consume,
          cr: zero,
          description: `ใช้ค่าเผื่อหนี้สงสัยจะสูญที่ตั้งไว้ (${consume.toFixed(2)} ฿)`,
        });
        remainingLoss = remainingLoss.minus(consume);
      }

      if (remainingLoss.gt(0)) {
        lines.push({
          accountCode: '51-1102',
          dr: remainingLoss,
          cr: zero,
          description: provisionBalance.gt(0)
            ? 'ขาดทุนจากยึดเครื่อง (ส่วนเกินค่าเผื่อ)'
            : 'ขาดทุนจากยึดเครื่อง',
        });
      }
    } else if (lossOrGain.lt(0)) {
      // Gain — Cr 41-1102
      lines.push({
        accountCode: '41-1102',
        dr: zero,
        cr: lossOrGain.abs(),
        description: 'รายได้จากการยึดสินค้า',
      });
    }

    const result = await this.journal.createAndPost(
      {
        description: `ยึดเครื่อง — สัญญา ${c.contractNumber} (${unpaid} งวดคงเหลือ)`,
        reference: `${c.id}:repossession`,
        metadata: {
          tag: 'JP5',
          flow: 'repossession',
          contractId: c.id,
          unpaidInstallments: unpaid,
          accruedInstallments: accruedInsts.length,
          deferredInstallments: deferredInsts.length,
          repossessionValue: input.repossessionValue.toFixed(2),
          // Wave 2 T2: Credit Note tracking (per ม.82/5)
          creditNoteIssued: accruedCount.gt(0),
          creditNoteVatAmount: accruedCreditNoteVat.toFixed(2),
        },
        lines,
      },
      tx,
    );

    return { entryNo: result.entryNumber };
  }
}
