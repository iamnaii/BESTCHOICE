import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
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
 * Loss path (repossessionValue < remainingTotal):
 *   Dr depositAccountCode            repossessionValue
 *   Dr 11-2106 รายได้รอตัดบัญชี-ดอกเบี้ย  remainingDeferredInterest
 *   Dr 21-2102 ล้างภาษีขายรอเรียกเก็บ      remainingDeferredVat
 *   Dr 51-1102 ขาดทุนจากยึดเครื่อง         loss
 *     Cr 11-2101 ลูกหนี้ Gross              remainingGross
 *     Cr 11-2105 ลูกหนี้ภาษีขายรอฯ          remainingDeferredVat
 *     Cr 21-2101 ภาษีขาย ภ.พ.30            remainingDeferredVat
 *     Cr 41-1101 รายได้ดอกเบี้ย             remainingDeferredInterest
 *
 * Gain path (repossessionValue > remainingTotal):
 *   Same but 51-1102 replaced with Cr 41-1102 รายได้จากการยึดสินค้า (gain amount)
 *
 * Calculations (per-installment, consistent rounding with 2A/2B):
 *   installmentExclVat = grossExclVat / totalMonths  (ROUND_DOWN)
 *   interestPerInst    = interestTotal / totalMonths  (ROUND_HALF_UP)
 *   vatPerInst         = vatTotal / totalMonths       (ROUND_HALF_UP)
 *   remainingGross     = installmentExclVat × unpaid
 *   remainingDeferredInterest = interestPerInst × unpaid
 *   remainingDeferredVat      = vatPerInst × unpaid
 *   remainingTotal     = remainingGross + remainingDeferredVat
 *   loss               = remainingTotal - repossessionValue  (when > 0)
 *   gain               = repossessionValue - remainingTotal  (when > 0)
 */
@Injectable()
export class RepossessionJP5Template {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: RepossessionInput): Promise<{ entryNo: string }> {
    const c = await this.prisma.contract.findUniqueOrThrow({ where: { id: input.contractId } });

    // Determine unpaid installments via Payment table (no status field on InstallmentSchedule)
    const allInsts = await this.prisma.installmentSchedule.findMany({
      where: { contractId: c.id, deletedAt: null },
      orderBy: { installmentNo: 'asc' },
    });
    const paidPayments = await this.prisma.payment.findMany({
      where: { contractId: c.id, status: 'PAID' },
      select: { installmentNo: true },
    });
    const paidNos = new Set(paidPayments.map((p) => p.installmentNo));
    const unpaidInsts = allInsts.filter((i) => !paidNos.has(i.installmentNo));
    const unpaid = unpaidInsts.length;

    if (unpaid === 0) {
      throw new Error('No unpaid installments — nothing to repossess');
    }

    const unpaidD = new Decimal(unpaid);
    const total = new Decimal(c.totalMonths);

    const financed = new Decimal(c.financedAmount.toString());
    const commission =
      (c as any).storeCommission != null
        ? new Decimal((c as any).storeCommission.toString())
        : financed.times('0.10').toDecimalPlaces(2);
    const interest = new Decimal((c as any).interestTotal.toString());
    const grossExclVat = financed.plus(commission).plus(interest);
    const vat =
      (c as any).vatAmount != null
        ? new Decimal((c as any).vatAmount.toString())
        : grossExclVat.times('0.07').toDecimalPlaces(2);

    // Per-installment rounding (same as 2A/2B)
    const installmentExclVat = grossExclVat.div(total).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const interestPerInst = interest.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const vatPerInst = vat.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const remainingGross = installmentExclVat.times(unpaidD);
    const remainingDeferredInterest = interestPerInst.times(unpaidD);
    const remainingDeferredVat = vatPerInst.times(unpaidD);
    const remainingTotal = remainingGross.plus(remainingDeferredVat);

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
      {
        accountCode: '11-2106',
        dr: remainingDeferredInterest,
        cr: zero,
        description: 'ยกเลิกรายได้รอตัดบัญชี-ดอกเบี้ย',
      },
      {
        accountCode: '21-2102',
        dr: remainingDeferredVat,
        cr: zero,
        description: 'ล้างภาษีขายรอเรียกเก็บ',
      },
      {
        accountCode: '11-2101',
        dr: zero,
        cr: remainingGross,
        description: 'ล้างลูกหนี้ Gross (excl. VAT)',
      },
      {
        accountCode: '11-2105',
        dr: zero,
        cr: remainingDeferredVat,
        description: 'ล้างลูกหนี้ภาษีขายรอฯ',
      },
      {
        accountCode: '21-2101',
        dr: zero,
        cr: remainingDeferredVat,
        description: 'ภาษีขาย ภ.พ.30 ถึงกำหนด',
      },
      {
        accountCode: '41-1101',
        dr: zero,
        cr: remainingDeferredInterest,
        description: 'รับรู้รายได้ดอกเบี้ย',
      },
    ];

    if (lossOrGain.gt(0)) {
      // Loss — Dr 51-1102
      lines.push({
        accountCode: '51-1102',
        dr: lossOrGain,
        cr: zero,
        description: 'ขาดทุนจากยึดเครื่อง',
      });
    } else if (lossOrGain.lt(0)) {
      // Gain — Cr 41-1102
      lines.push({
        accountCode: '41-1102',
        dr: zero,
        cr: lossOrGain.abs(),
        description: 'รายได้จากการยึดสินค้า',
      });
    }

    const result = await this.journal.createAndPost({
      description: `ยึดเครื่อง — สัญญา ${c.contractNumber} (${unpaid} งวดคงเหลือ)`,
      reference: `${c.id}:repossession`,
      metadata: {
        tag: '3',
        flow: 'repossession',
        contractId: c.id,
        unpaidInstallments: unpaid,
        repossessionValue: input.repossessionValue.toFixed(2),
      },
      lines,
    });

    return { entryNo: result.entryNumber };
  }
}
