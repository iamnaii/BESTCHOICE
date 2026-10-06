import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import {
  EARLY_PAYOFF_ROUNDING_TOLERANCE,
  buildEarlyPayoffJE,
  readEarlyPayoffLedger,
} from '../compute-early-payoff-je';
import { glContractBalance } from '../gl-contract-balance';
import { computeInstallmentBreakdown } from '../compute-installment-breakdown';
import { PrismaService } from '../../../prisma/prisma.service';
import { Vat60dayReversalTemplate } from './vat-60day-reversal.template';

export interface EarlyPayoffInput {
  contractId: string;
  depositAccountCode: string;
  /**
   * เงินที่รับจริง (PR5 — คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 5.3) — ขา Dr บัญชีรับเงิน และยอดที่กระจายลงแถว Payment.
   * ส่วนลด 52-1106 = ลูกหนี้ตามบัญชี + ค่าปรับ − เงินที่รับ − เงินพัก (template ไม่คิดยอดที่ลูกค้าต้องจ่ายเอง)
   */
  cashReceived: Decimal;
  /**
   * 0..100 — ส่วนลดที่ตกลงกับลูกค้า (ใช้ในคำอธิบาย metadata และวัดส่วนของ 52-1106 ที่เกินฐานข้อ 5.2 เท่านั้น — ยอด 52-1106
   * มาจาก `cashReceived`)
   */
  interestDiscountPercent: Decimal;
  /**
   * ค่าปรับค้างชำระ — ต้องเป็นยอด NETTED (หัก waived + หัก Cr 42-1103 ที่ลง
   * ผ่าน partial แล้ว — ดู ContractPaymentService.computeUnbookedLateFees).
   * Omitted → 0. หมายเหตุ: template นี้ไม่มี production caller — เส้นทางจริงคือ
   * earlyPayoff() ใน contract-payment.service ซึ่ง net ให้เองแล้ว.
   */
  unpaidLateFees?: Decimal;
  /**
   * ยอดปลดหนี้ถังพักงวดสุดท้าย (21-1103) — ต้องเป็นยอดที่ยอดปิดสัญญาดูดซับจริง
   * (`computePayoffQuote(...).rescheduleAdvanceApplied`). Omitted → 0 = ไม่มีขา
   * 21-1103 และไม่แตะคอลัมน์ `Contract.rescheduleAdvanceBalance` เลย.
   * หมายเหตุเดียวกับ unpaidLateFees: template นี้ไม่มี production caller —
   * เส้นทางจริงคือ earlyPayoff() ใน contract-payment.service.
   */
  parkRelief?: Decimal;
}

/**
 * Template JP4 — Early Payoff (Case 4).
 *
 * Spec §6.4 — close out remaining installments. **ไม่มีผู้เรียกใน production** — เส้นทางจริงคือ
 * `ContractPaymentService.earlyPayoff()` (ใช้ `buildEarlyPayoffJournal` ตัวเดียวกับ preview).
 *
 * PR5 (คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 5.1–5.4 · 29/09/2569): ล้างตามยอดในบัญชีของสัญญา (`readEarlyPayoffLedger`) และ
 * ใช้ฟังก์ชันบริสุทธิ์ `buildEarlyPayoffJE` ตัวเดียวกับเส้นทางจริง:
 *   Dr depositAccountCode   cashReceived (เงินที่รับจริง)
 *   Dr 11-2106 / Cr 41-1101 ดอกเบี้ยรอตัดบัญชีคงเหลือ (ส่วนที่ยังไม่ถึงกำหนด)
 *   Dr 21-2102 / Cr 21-2101 ภาษีขายรอเรียกเก็บคงเหลือ (Policy A — เต็มจำนวน ไม่ลดตามส่วนลด)
 *   Dr 52-1106              ส่วนลดที่ให้จริง = ลูกหนี้ตามบัญชี + ค่าปรับ − เงินที่รับ − เงินพัก
 *   Dr 21-1103              เงินพักค่าปรับดิว (clamp ด้วยคอลัมน์ถังพักและยอด 21-1103 ในบัญชี)
 *     Cr 11-2103 / 11-2101 / 11-2105  ลูกหนี้ตามยอดในบัญชี
 *     Cr 42-1103            ค่าปรับ · Cr 53-1503 เงินที่รับเกินลูกหนี้ตามบัญชี ≤ 1.00
 * Policy A (CPA decision · 2026-05-09): ไม่ออกใบลดหนี้ (Credit Note) per ม.82/5 — บริษัทรับภาระ VAT ส่วนเกินเอง.
 * Refs: docs/superpowers/specs/2026-05-09-cpa-policy-a-100-compliance-design.md
 * template ไม่แตะเงินเกินของลูกค้า 21-5101 และเงินรับล่วงหน้าถังรวม (เส้นทางจริงล้าง 21-5101 เอง) · อ่านยอดในบัญชีใน
 * ธุรกรรมเดียวกับการลงรายการ (`exec`) — ไม่ว่าผู้เรียกจะส่ง `outerTx` มาหรือไม่.
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

    // ยอดต่องวดสำรองของแถว Payment ที่ตารางงวดไม่มี amountDue (ข้อมูลเก่า) — สูตรเดียวกับ 2A/2B
    const { installmentTotal } = computeInstallmentBreakdown({
      financedAmount: c.financedAmount.toString(),
      storeCommission: c.storeCommission != null ? c.storeCommission.toString() : null,
      interestTotal: c.interestTotal.toString(),
      vatAmount: c.vatAmount != null ? c.vatAmount.toString() : null,
      totalMonths: c.totalMonths,
    });

    // Wrap JE post + Payment.create loop in a single atomic transaction.
    // If JE post fails (unbalanced, missing account), Payment rows are rolled back — no orphans.
    const exec = async (tx: Prisma.TransactionClient) => {
      // PR5 — ฟังก์ชันบริสุทธิ์ตัวเดียวกับที่ preview และเส้นทางจริง (ContractPaymentService) ใช้ · ยอดล้างอ่านจากบัญชี
      // ในธุรกรรมเดียวกับการลงรายการ
      const je = buildEarlyPayoffJE({
        depositAccountCode: input.depositAccountCode,
        cashReceived: input.cashReceived,
        ledger: await readEarlyPayoffLedger(tx, c.id),
        unpaidLateFees: input.unpaidLateFees ?? null,
        // clamp ด้วยยอดในถังบนสัญญาและยอด 21-1103 ในบัญชี — ห้ามปลดหนี้เกินกว่าที่มีอยู่จริง (กติกาเดียวกับเส้นทางจริง)
        parkRelief: Decimal.max(
          0,
          Decimal.min(
            new Decimal(input.parkRelief ?? 0),
            new Decimal(c.rescheduleAdvanceBalance ?? 0),
            await glContractBalance(tx, c.id, '21-1103', 'cr'),
          ),
        ),
        discountPercent: input.interestDiscountPercent,
      });
      if (je.excessReceived.gt(0)) {
        throw new Error(
          `JP4 template: cashReceived + park relief exceed the contract ledger receivable by ` +
            `${je.excessReceived.toFixed(2)} (> 1.00) — not posted`,
        );
      }
      const { discount, parkRelief, cashReceived } = je;

      // Ledger-side line descriptions; the money (accountCode/dr/cr — no zero lines)
      // comes from the shared buildEarlyPayoffJE. บรรทัดที่ไม่มีในตาราง (11-2103 / 53-1503) ไม่มีคำอธิบาย.
      const descriptions: Record<string, string> = {
        [input.depositAccountCode]: `รับ ${cashReceived.toFixed(2)} ฿ ปิดยอด`,
        '21-1103': 'หักเงินพักปรับดิว (ปิดสัญญาก่อนกำหนด)',
        '11-2106': 'ยกเลิกรายได้รอตัดบัญชี-ดอกเบี้ย',
        '21-2102': 'ล้างภาษีขายรอเรียกเก็บ',
        '52-1106': `ส่วนลดดอกเบี้ย-ปิดยอดก่อนกำหนด ${input.interestDiscountPercent}%`,
        '11-2101': 'ล้างลูกหนี้ Gross (excl. VAT)',
        '11-2105': 'ล้างลูกหนี้ภาษีขายรอฯ',
        '41-1101': 'รับรู้รายได้ดอกเบี้ย (เต็มจำนวน; ส่วนลดอยู่ฝั่ง Dr 52-1106)',
        '21-2101': 'ภาษีขาย ภ.พ.30 ถึงกำหนด (Policy A: VAT ไม่ลดตามส่วนลด)',
      };
      const lines: JeLineInput[] = je.lines.map((l) => ({
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
            settleVat: je.deferredVat.toFixed(2),
            cashReceived: cashReceived.toFixed(2),
            ...(parkRelief.gt(0) ? { parkRelief: parkRelief.toFixed(2) } : {}),
            ...(je.roundingGain.gt(0) ? { roundingGain: je.roundingGain.toFixed(2) } : {}),
            ...(je.discountBeyondDeferredBase.gt(EARLY_PAYOFF_ROUNDING_TOLERANCE)
              ? { discountBeyondDeferredBase: je.discountBeyondDeferredBase.toFixed(2) }
              : {}),
          },
          lines,
        },
        tx,
      );

      // ปลดถังพักงวดสุดท้ายให้ตรงกับขา Dr 21-1103 ที่เพิ่งลง — ต้องอยู่ใน tx
      // เดียวกับ JE ไม่งั้นเครดิตผีค้างบนสัญญาที่ปิดไปแล้ว (บั๊ก C-3).
      if (parkRelief.gt(0)) {
        await tx.contract.update({
          where: { id: c.id },
          data: { rescheduleAdvanceBalance: { decrement: parkRelief } },
        });
      }

      // Create Payment rows for all unpaid installments (marks them as settled via EARLY_PAYOFF).
      // Each installment gets its own Payment row; total across all = cashReceived (เงินที่รับจริง).
      // We tag via notes to distinguish from normal payments.
      const perInstSettlement = cashReceived.div(unpaidD).toDecimalPlaces(2, Decimal.ROUND_DOWN);
      let distributed = new Decimal(0);
      for (let idx = 0; idx < unpaidInsts.length; idx++) {
        const inst = unpaidInsts[idx];
        const isLast = idx === unpaidInsts.length - 1;
        // Absorb rounding remainder in last installment
        const thisAmount = isLast ? cashReceived.minus(distributed) : perInstSettlement;
        distributed = distributed.plus(thisAmount);
        await tx.payment.create({
          data: {
            contractId: c.id,
            installmentNo: inst.installmentNo,
            dueDate: inst.dueDate,
            amountDue: inst.amountDue ?? installmentTotal,
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
