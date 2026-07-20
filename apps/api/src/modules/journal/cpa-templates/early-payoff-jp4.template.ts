import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { computeEarlyPayoffJE } from '../compute-early-payoff-je';
import { PrismaService } from '../../../prisma/prisma.service';
import { Vat60dayReversalTemplate } from './vat-60day-reversal.template';

export interface EarlyPayoffInput {
  contractId: string;
  depositAccountCode: string;
  /** 0..100 — percentage of remaining deferred interest to waive */
  interestDiscountPercent: Decimal;
  /**
   * ค่าปรับค้างชำระ — ต้องเป็นยอด NETTED (หัก waived + หัก Cr 42-1103 ที่ลง
   * ผ่าน partial แล้ว — ดู ContractPaymentService.computeUnbookedLateFees).
   * Omitted → 0. หมายเหตุ: template นี้ไม่มี production caller — เส้นทางจริงคือ
   * earlyPayoff() ใน contract-payment.service ซึ่ง net ให้เองแล้ว.
   */
  unpaidLateFees?: Decimal;
}

/**
 * Template JP4 — Early Payoff (Case 4).
 *
 * Spec §6.4 — close out remaining installments with optional interest discount.
 * Policy A (CPA decision · 2026-05-09):
 *   VAT ไม่ลดตามส่วนลดดอกเบี้ย — Cr 21-2101 = remainingDeferredVat เต็มยอด
 *   ไม่ออกใบลดหนี้ (Credit Note) per ม.82/5 — บริษัทเลือก Policy A vs ม.79+86/10
 * Refs: docs/superpowers/specs/2026-05-09-cpa-policy-a-100-compliance-design.md
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
 *   interestPerInst    = interestTotal / totalMonths  (ROUND_HALF_UP)
 *   vatPerInst         = vatTotal / totalMonths       (ROUND_HALF_UP)
 *   remainingGross     = installmentExclVat × unpaid
 *   remainingDeferredInterest = interestPerInst × unpaid
 *   remainingDeferredVat      = vatPerInst × unpaid
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
    // Round 2 I1 fix: required injection (was @Optional() in round 1).
    // Failure to wire Vat60dayReversalTemplate at module bootstrap should
    // be a startup error, not a silent skip — silently bypassing it on
    // an early payoff would leave 11-2104 + 21-2103 dangling forever.
    // Test stubs must inject a real Vat60dayReversalTemplate instance.
    private readonly vat60Reversal: Vat60dayReversalTemplate,
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

    // Single source of truth — the SAME pure function the JE preview and the
    // ledger posting (ContractPaymentService) use, so this template can never
    // drift from what the customer is quoted (preview === posted).
    // Policy A (CPA decision · 2026-05-09): VAT ไม่ลดตามส่วนลดดอกเบี้ย — Cr 21-2101
    // = remainingDeferredVat เต็ม; ไม่ออกใบลดหนี้ (Credit Note); บริษัทรับภาระ VAT
    // ส่วนเกินจาก discount เอง. Ref:
    //   docs/superpowers/specs/2026-05-09-cpa-policy-a-100-compliance-design.md
    //   + Handover_BestChoiceFinance v3.0.pdf §9 Policy Decisions
    const {
      installmentExclVat,
      vatPerInst,
      remainingGross,
      remainingDeferredInterest,
      remainingDeferredVat,
      discount,
      settleVat,
      settlement,
      lines: jeLines,
    } = computeEarlyPayoffJE({
      depositAccountCode: input.depositAccountCode,
      financedAmount: c.financedAmount.toString(),
      storeCommission: c.storeCommission != null ? c.storeCommission.toString() : null,
      interestTotal: c.interestTotal.toString(),
      vatAmount: c.vatAmount != null ? c.vatAmount.toString() : null,
      totalMonths: c.totalMonths,
      unpaidCount: unpaid,
      interestDiscountPercent: input.interestDiscountPercent,
      unpaidLateFees: input.unpaidLateFees ?? null,
    });

    // Wrap JE post + Payment.create loop in a single atomic transaction.
    // If JE post fails (unbalanced, missing account), Payment rows are rolled back — no orphans.
    const exec = async (tx: Prisma.TransactionClient) => {
      // Ledger-side line descriptions; the money (accountCode/dr/cr, incl. the
      // 52-1106 zero-discount guard) comes from the shared computeEarlyPayoffJE.
      const descriptions: Record<string, string> = {
        [input.depositAccountCode]: `รับ ${settlement.toFixed(2)} ฿ ปิดยอด`,
        '11-2106': 'ยกเลิกรายได้รอตัดบัญชี-ดอกเบี้ย',
        '21-2102': 'ล้างภาษีขายรอเรียกเก็บ',
        '52-1106': `ส่วนลดดอกเบี้ย-ปิดยอดก่อนกำหนด ${input.interestDiscountPercent}%`,
        '11-2101': 'ล้างลูกหนี้ Gross (excl. VAT)',
        '11-2105': 'ล้างลูกหนี้ภาษีขายรอฯ',
        '41-1101': 'รับรู้รายได้ดอกเบี้ย (เต็มจำนวน; ส่วนลดอยู่ฝั่ง Dr 52-1106)',
        '21-2101': 'ภาษีขาย ภ.พ.30 ถึงกำหนด (Policy A: VAT ไม่ลดตามส่วนลด)',
      };
      const lines: JeLineInput[] = jeLines.map((l) => ({
        accountCode: l.accountCode,
        dr: l.dr,
        cr: l.cr,
        description: descriptions[l.accountCode] ?? '',
      }));

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
            // Policy A — VAT ไม่ลดตามส่วนลด (CPA decision · vs ม.79+86/10)
            policy: 'A',
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

      // C3 fix: reverse any 60-day mandatory VAT JEs on the installments
      // being closed. Without this, 11-2104 receivable + 21-2103 RD liability
      // would remain on the balance sheet forever for early-paid-off contracts
      // that had been 60d-flagged. Runs inside the same tx so a reversal
      // failure rolls back the JP4 JE — no partial state.
      //
      // Round 2 I1 fix: vat60Reversal is now required (was @Optional()) — no
      // null check needed. DI failure surfaces at app bootstrap, not silently
      // at runtime.
      for (const inst of unpaidInsts) {
        if (inst.vat60dayJournalEntryId) {
          await this.vat60Reversal.execute(inst.id, tx);
        }
      }

      return result.entryNumber;
    };

    const entryNumber = outerTx ? await exec(outerTx) : await this.prisma.$transaction(exec);

    return { entryNo: entryNumber };
  }
}
