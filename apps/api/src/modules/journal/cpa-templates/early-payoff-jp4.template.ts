import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { allocateInterestEIR } from '../utils/eir';

export interface EarlyPayoffInput {
  contractId: string;
  depositAccountCode: string;
  /** 0..100 — percentage of remaining deferred interest to waive */
  interestDiscountPercent: Decimal;
}

/**
 * Template JP4 — Early Payoff (Case 4).
 *
 * Spec §6.4 — close out remaining installments with optional interest discount.
 *
 * Wave 2 Task 3 (ป.รัษฎากร ม.79 + ม.86/10):
 *   ฐาน VAT = "ราคาที่ได้รับจริง" → ถ้ามีส่วนลดดอกเบี้ย ฐาน VAT ลดตามส่วน
 *   vatOnDiscount = discount × 7%. นำส่งจริงเหลือ settleVat = remainingDeferredVat
 *   - vatOnDiscount.
 *
 *   - Cash settlement ลดลงด้วย vatOnDiscount (ลูกค้าจ่ายน้อยลง)
 *   - Cr 21-2101 (VAT ภ.พ.30) = settleVat (ลด)
 *   - Dr 21-2102 ยังคงเต็ม (ปิดบัญชี deferred VAT — ไม่มี balance ค้าง)
 *   - การ "credit back" 105 ที่ไม่ต้องนำส่ง สะท้อนทาง balance asymmetry
 *     ระหว่าง Dr 21-2102 (เต็ม 595.02) กับ Cr 21-2101 (490.02) ผ่านยอดรับ
 *     เงินสดที่ลดลง — economically correct, ledger balanced
 *   - vatCreditBackOnDiscount เก็บใน metadata เพื่อ traceability
 *
 *   Dr depositAccountCode          settlementAmount  (= remainingGross - discount + settleVat)
 *   Dr 11-2106 รายได้รอตัดบัญชี-ดอกเบี้ย  remainingDeferredInterest
 *   Dr 21-2102 ล้างภาษีขายรอเรียกเก็บ      remainingDeferredVat
 *   Dr 52-1106 ส่วนลดดอกเบี้ย-ปิดยอด       discount  (only if discount > 0)
 *     Cr 11-2101 ลูกหนี้ Gross              remainingGross
 *     Cr 11-2105 ลูกหนี้ภาษีขายรอฯ          remainingDeferredVat
 *     Cr 41-1101 รายได้ดอกเบี้ย             remainingDeferredInterest
 *     Cr 21-2101 ภาษีขาย ภ.พ.30            settleVat  (= remainingDeferredVat - vatOnDiscount)
 *
 * VAT discount policy (Wave 4 / Task 2 — Info comments):
 *   - ป.รัษฎากร ม.79: ฐาน VAT = "ราคาที่ได้รับจริง" (ไม่รวมส่วนลดที่ผู้ขายให้
 *     แก่ผู้ซื้อขณะส่งมอบ/รับชำระ) → ส่วนลดดอกเบี้ย ทำให้ฐาน VAT ลดลง
 *     ตามส่วน vatOnDiscount = discount × 7%.
 *   - ป.รัษฎากร ม.86/10: ผู้ขาย VAT ต้องออกใบลดหนี้ (credit note) สำหรับ
 *     ส่วน VAT ที่ลด — ทำให้ Cr 21-2101 (VAT ภ.พ.30) ลดเหลือ settleVat แทน
 *     remainingDeferredVat เต็มจำนวน.
 *   - Dr 21-2102 ยังคงเต็ม (ปิดบัญชี deferred VAT ไม่ให้มี balance ค้าง);
 *     ส่วนต่าง vatOnDiscount สะท้อนผ่าน Cash leg ที่ลดลง — JE ยัง balanced.
 *
 * Derivations (per-installment using same rounding as 2A/2B):
 *   installmentExclVat = grossExclVat / totalMonths  (ROUND_DOWN)
 *   vatPerInst         = vatTotal / totalMonths       (ROUND_HALF_UP)
 *   remainingGross     = installmentExclVat × unpaid
 *   remainingDeferredVat      = vatPerInst × unpaid
 *
 *   --- EIR allocation (Phase 3 — TFRS 15 §60-65) ---
 *   eirPrincipal       = financedAmount + storeCommission
 *   interestSchedule   = allocateInterestEIR(eirPrincipal, interestTotal, totalMonths)
 *   remainingDeferredInterest = sum of interestSchedule[period - 1] for each unpaid period
 *
 *   --- Discount + VAT base reduction ---
 *   discount           = remainingDeferredInterest × interestDiscountPercent / 100
 *   vatOnDiscount      = discount × 0.07  (ROUND_HALF_UP)
 *   settleVat          = remainingDeferredVat - vatOnDiscount
 *   settlementAmount   = remainingGross - discount + settleVat
 *
 * After posting: marks all unpaid installments as PAID and creates 1 Payment row
 * tagged EARLY_PAYOFF.
 */
@Injectable()
export class EarlyPayoffJP4Template {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: EarlyPayoffInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const readClient = outerTx ?? this.prisma;
    const c = await readClient.contract.findUniqueOrThrow({ where: { id: input.contractId } });

    // Determine unpaid installments: those without a PAID Payment record
    const allInsts = await readClient.installmentSchedule.findMany({
      where: { contractId: c.id, deletedAt: null },
      orderBy: { installmentNo: 'asc' },
    });
    const paidPayments = await readClient.payment.findMany({
      where: { contractId: c.id, status: 'PAID' },
      select: { installmentNo: true },
    });
    const paidNos = new Set(paidPayments.map((p) => p.installmentNo));
    const unpaidInsts = allInsts.filter((i) => !paidNos.has(i.installmentNo));
    const unpaid = unpaidInsts.length;

    if (unpaid === 0) {
      throw new Error('All installments already paid; nothing to pay off');
    }

    const unpaidD = new Decimal(unpaid);
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

    // Per-installment amounts (consistent with 2A/2B rounding)
    // NOTE: installmentExclVat + vatPerInst are still straight-line constant.
    // Only interest allocation moved to EIR (Phase 3).
    const installmentExclVat = grossExclVat.div(total).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const vatPerInst = vat.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    // Phase 3 — EIR allocation for remaining interest (TFRS 15 §60-65)
    // Interest per period declines as principal balance reduces.
    // EIR principal = financedAmount + storeCommission (matches 2A logic).
    const eirPrincipal = financed.plus(commission);
    const interestSchedule = allocateInterestEIR(eirPrincipal, interest, c.totalMonths);

    // Sum interest for unpaid periods only (period N → interestSchedule[N - 1])
    const remainingDeferredInterest = unpaidInsts.reduce(
      (sum, inst) => sum.add(interestSchedule[inst.installmentNo - 1]),
      new Decimal(0),
    );

    // Remaining balances for unpaid installments
    const remainingGross = installmentExclVat.times(unpaidD);
    const remainingDeferredVat = vatPerInst.times(unpaidD);

    // Discount on interest only
    const discount = remainingDeferredInterest
      .times(input.interestDiscountPercent)
      .div(100)
      .toDecimalPlaces(2);

    // Wave 2 T3 — ม.79 + ม.86/10: VAT base = "ราคาที่ได้รับจริง"
    // ถ้ามีส่วนลดดอกเบี้ย → ฐาน VAT ลดตามส่วน · Cr 21-2101 (VAT ภ.พ.30)
    // ลดเป็น settleVat. Dr 21-2102 ยังเต็ม (ปิด deferred VAT). ความต่าง 105
    // สะท้อนทาง Cash ที่ลดลง — JE balanced. vatCreditBackOnDiscount เก็บใน
    // metadata เพื่อ traceability + reporting.
    const vatOnDiscount = discount
      .times(new Decimal('0.07'))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const settleVat = remainingDeferredVat.minus(vatOnDiscount);

    // Settlement amount customer pays (reduced by both discount and vatOnDiscount)
    const settlement = remainingGross.minus(discount).plus(settleVat);

    const zero = new Decimal(0);

    // Wrap JE post + Payment.create loop in a single atomic transaction.
    // If JE post fails (unbalanced, missing account), Payment rows are rolled back — no orphans.
    const exec = async (tx: Prisma.TransactionClient) => {
      const lines: JeLineInput[] = [
        {
          accountCode: input.depositAccountCode,
          dr: settlement,
          cr: zero,
          description: `รับ ${settlement.toFixed(2)} ฿ ปิดยอด`,
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
      ];

      if (discount.gt(0)) {
        lines.push({
          accountCode: '52-1106',
          dr: discount,
          cr: zero,
          description: `ส่วนลดดอกเบี้ย-ปิดยอดก่อนกำหนด ${input.interestDiscountPercent}%`,
        });
      }

      lines.push(
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
          accountCode: '41-1101',
          dr: zero,
          cr: remainingDeferredInterest,
          description: 'รับรู้รายได้ดอกเบี้ย (เต็มจำนวน; ส่วนลดอยู่ฝั่ง Dr 52-1106)',
        },
        {
          accountCode: '21-2101',
          dr: zero,
          cr: settleVat,
          description: vatOnDiscount.gt(0)
            ? `ภาษีขาย ภ.พ.30 ถึงกำหนด (ลด ${vatOnDiscount.toFixed(2)} ตามส่วนลด ม.79)`
            : 'ภาษีขาย ภ.พ.30 ถึงกำหนด',
        },
      );

      const result = await this.journal.createAndPost(
        {
          description: `ปิดยอดก่อนกำหนด — สัญญา ${c.contractNumber} (${unpaid} งวดคงเหลือ, ส่วนลด ${input.interestDiscountPercent}%)`,
          reference: `${c.id}:early-payoff`,
          metadata: {
            tag: 'JP4',
            flow: 'early-payoff',
            contractId: c.id,
            unpaidInstallments: unpaid,
            discount: discount.toFixed(2),
            interestDiscountPercent: input.interestDiscountPercent.toFixed(2),
            // Wave 2 T3 — VAT credit back per ม.79 + ม.86/10
            vatCreditBackOnDiscount: vatOnDiscount.toFixed(2),
            settleVat: settleVat.toFixed(2),
          },
          lines,
        },
        tx,
      );

      // Create Payment rows for all unpaid installments (marks them as settled via EARLY_PAYOFF).
      // Each installment gets its own Payment row; total across all = settlementAmount.
      // We tag via notes to distinguish from normal payments.
      const perInstSettlement = settlement.div(unpaidD).toDecimalPlaces(2, Decimal.ROUND_DOWN);
      let distributed = new Decimal(0);
      for (let idx = 0; idx < unpaidInsts.length; idx++) {
        const inst = unpaidInsts[idx];
        const isLast = idx === unpaidInsts.length - 1;
        // Absorb rounding remainder in last installment
        const thisAmount = isLast ? settlement.minus(distributed) : perInstSettlement;
        distributed = distributed.plus(thisAmount);
        await tx.payment.create({
          data: {
            contractId: c.id,
            installmentNo: inst.installmentNo,
            dueDate: inst.dueDate,
            amountDue: inst.amountDue ?? installmentExclVat.plus(vatPerInst),
            amountPaid: thisAmount,
            paidDate: new Date(),
            paidAt: new Date(),
            status: 'PAID',
            notes: 'EARLY_PAYOFF',
          },
        });
      }

      return result.entryNumber;
    };

    const entryNumber = outerTx ? await exec(outerTx) : await this.prisma.$transaction(exec);

    return { entryNo: entryNumber };
  }
}
