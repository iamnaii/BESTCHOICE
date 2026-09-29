import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountRoleService } from '../../journal/account-role.service';
import { computeInstallmentBreakdown } from '../../journal/compute-installment-breakdown';
import { splitReceipt } from '../../journal/split-receipt';
import { buildReceiptLines } from '../../journal/build-receipt-lines';
import {
  buildAccrual2ALines,
  isDueDateReached,
  resolveAccrualPostingDate,
} from '../../journal/build-accrual-2a-lines';
import { decideAccrueAtReceipt } from '../../journal/accrue-at-receipt-decision';
import { formatDateShort } from '../../../utils/thai-date.util';
import {
  reconstructPriorCleared,
  ADVANCE_CONSUME_ON_ACCRUAL_FLOW,
  RESCHEDULE_PARK_CONSUME_FLOW,
} from '../../journal/reconstruct-prior';
import {
  buildPreviewBlocks,
  PreviewTaggedLine,
  BlockSubtotal,
} from './payment-preview-blocks.util';

/**
 * Read-only JE preview builder (RecordPaymentWizard "Journal Auto" live preview).
 * Persists NOTHING — no $transaction. Mirrors PaymentReceipt2BTemplate /
 * JP6 / advance-split logic to show the lines the save will post. Body moved
 * VERBATIM from the legacy PaymentsService.
 *
 * accountRoleService is @Optional (resolves adj_underpay/adj_overpay → CoA code;
 * falls back to 52-1104 / 53-1503). Constructed internally by PaymentsService.
 */
@Injectable()
export class PaymentJournalPreviewService {
  constructor(
    private prisma: PrismaService,
    private accountRoleService: AccountRoleService | undefined,
  ) {}

  /**
   * Preview JE lines for a payment without persisting anything.
   * Used by the RecordPaymentWizard frontend to show "Journal Auto" live.
   *
   * Logic mirrors PaymentReceiptTemplate (PR-843/I2 primitive) but read-only:
   * the live lines ALWAYS clear 11-2103. งวดที่ยังไม่มีรายการ 2A จะถูกตั้งลูกหนี้งวดในการบันทึก
   * เดียวกันเมื่อการรับชำระทำให้งวดชำระครบ (คำตัดสินฝ่ายบัญชี D2, 2026-09-28) — preview จึงคืนบล็อก `accrual2A` ที่
   * `posted: false` จากตัวสร้างบรรทัดเดียวกับ InstallmentAccrual2ATemplate.
   * `accrualMode` tells the UI whether 2A already ran (2B_ONLY) or will post with
   * this receipt (CONSOLIDATED_PAYING_AHEAD = ลงวันที่รับเงิน / CONSOLIDATED_BACKFILL =
   * ลงวันครบกำหนด).
   * - Late fee → Cr 42-1103 ค่าปรับชำระล่าช้า (same JE)
   */
  async previewJournal(input: {
    contractId: string;
    installmentNo: number;
    amountReceived: number;
    depositAccountCode: string;
    lateFee?: number;
    /** Waived (gross-model) portion of the late fee → Dr 52-1105 (default 0). */
    lateFeeWaived?: number;
    case?: string;
    daysToShift?: number;
    splitMode?: string;
    /** Mirror the save's credit-deduction toggle so preview == posted JE. Default true. */
    consumeAdvance?: boolean;
    /** วันที่รับเงิน (ISO date) แบบเดียวกับที่ส่งตอนบันทึก — ใช้หาวันที่ลงรายการ 2A. ไม่ส่ง = ตอนนี้. */
    paidDate?: string;
    /**
     * ช่องทางที่เลือกบนหน้ารับชำระ ('QR' = ส่ง QR ให้ลูกค้า) — ใช้เลือกข้อความของด่านจ่ายบางส่วน และเมื่อเป็น
     * 'QR' ใช้ตัดสินว่าเงินที่จะเข้าทำให้งวดชำระครบหรือไม่ แบบเดียวกับเส้นทางยืนยันของผู้ให้บริการ.
     */
    method?: string;
  }): Promise<{
    lines: PreviewTaggedLine[];
    accrual2A?: { lines: PreviewTaggedLine[]; subtotal: BlockSubtotal };
    subtotals: { '2A'?: BlockSubtotal; '2B': BlockSubtotal };
    totalDebit: string;
    totalCredit: string;
    isBalanced: boolean;
    rescheduleFeeDisplay?: string;
    /**
     * 2B_ONLY: งวดนี้ตั้งลูกหนี้งวด (2A) ไปแล้ว — การบันทึกลงเฉพาะใบรับชำระ.
     * CONSOLIDATED_PAYING_AHEAD: ยังไม่มี 2A และรับเงินก่อนวันครบกำหนด — การบันทึกจะลง 2A
     *   ลงวันที่รับเงิน แล้วลงใบรับชำระ (2 รายการ ธุรกรรมเดียวกัน).
     * CONSOLIDATED_BACKFILL: ยังไม่มี 2A และรับเงินในหรือหลังวันครบกำหนด (รอบกลางคืนตกหล่น) —
     *   การบันทึกจะลง 2A ลงวันครบกำหนด แล้วลงใบรับชำระ.
     * (ชื่อค่าคงเดิมเพื่อไม่เปลี่ยนสัญญา API — ระบบไม่เคยรวม 2A+2B เป็นรายการเดียว)
     */
    accrualMode?: '2B_ONLY' | 'CONSOLIDATED_PAYING_AHEAD' | 'CONSOLIDATED_BACKFILL';
    dueDate?: string;
    /** วันที่ที่รายการ 2A จะถูกลง (ISO) — มีเฉพาะเมื่องวดนี้ยังไม่ตั้งลูกหนี้. */
    accrualPostedAt?: string;
  }> {
    const inst = await this.prisma.installmentSchedule.findUnique({
      where: {
        contractId_installmentNo: {
          contractId: input.contractId,
          installmentNo: input.installmentNo,
        },
      },
      include: { contract: true },
    });
    if (!inst) throw new NotFoundException('ไม่พบงวดชำระ');

    const c = inst.contract;
    const zero = new Prisma.Decimal(0);

    // Round 2 I3 audit: input.lateFee arrives as `number` from the DTO.
    // `.toString()` is defensive against Decimal constructor surprises on
    // large numbers — only this one site consumes input.lateFee raw, and
    // it's properly wrapped. Other code paths (record/preview controllers,
    // recordPayment service flow) re-read payment.lateFee from the DB which
    // is already Prisma.Decimal. No further coercion sites identified.
    const lateFeeAmount = input.lateFee ? new Prisma.Decimal(input.lateFee.toString()) : zero;
    // D1 gross-waiver: waived portion → Dr 52-1105; Cr 42-1103 stays GROSS (lateFeeAmount).
    // Cash only needs to cover the NET late fee (gross − waived). Clamp ≤ gross.
    const lateFeeWaivedAmount = input.lateFeeWaived
      ? Prisma.Decimal.min(new Prisma.Decimal(input.lateFeeWaived.toString()), lateFeeAmount)
      : zero;
    const netLateFee = lateFeeAmount.minus(lateFeeWaivedAmount);

    // Build raw JE lines (code, dr, cr, description)
    const rawLines: {
      code: string;
      dr: Prisma.Decimal;
      cr: Prisma.Decimal;
      description: string;
    }[] = [];

    // ด่าน "จ่ายบางส่วนก่อนตั้งลูกหนี้งวด" คงอยู่ (คำตัดสินผู้คุมงาน R2 + R9, 2026-09-29).
    // ใบรับชำระบางส่วนของงวดที่ยังไม่มี 2A ไม่ตั้งลูกหนี้งวด (ตั้งตามสัดส่วนเป็นงานถัดไป) จึงยังเครดิต
    // 11-2103 โดยไม่มีรายการตั้งลูกหนี้รองรับเหมือนเดิม — หน้าจอพนักงานต้องไม่ทำให้การจ่ายบางส่วนแบบนี้
    // ง่ายขึ้นกว่าเดิม. ข้อความชี้เฉพาะสิ่งที่ทำได้จริง: รับเต็มงวด หรือรอถึงวันครบกำหนด (รอบกลางคืนตั้ง
    // ลูกหนี้งวดให้ในวันครบกำหนด) / ติดต่อฝ่ายบัญชีเมื่อถึงวันครบกำหนดแล้วแต่ยังไม่ถูกตั้ง.
    // เมื่อเลือกชำระผ่าน QR หน้าจอไม่ใช้ผล preview เป็นด่าน (ปุ่มส่ง QR ยังกดได้ และเงินที่เข้าทาง QR ถูก
    // บันทึกตามเดิม) — ข้อความของโหมดนั้นจึงบอกเพียงว่าแผงนี้แสดงรายการบัญชีไม่ได้.
    // "ถึงวันครบกำหนดแล้ว" ตัดสินตามวันปฏิทินไทย: วันครบกำหนดเอง = ถึงแล้ว (ยังไม่ใช่เกินกำหนด).
    // (RESCHEDULE no longer needs this guard — its collect-first JE touches only
    //  21-1103 / 42-1103, never 11-2103; the old bundled-6b preview that credited
    //  11-2103 was replaced by the collect semantics on 2026-07-02.)
    if (!inst.accrualJournalEntryId && input.case === 'PARTIAL') {
      const dueLabel = formatDateShort(inst.dueDate);
      const dueReached = isDueDateReached(inst.dueDate, new Date());
      const situation = dueReached
        ? `งวดนี้ถึงวันครบกำหนดแล้ว (${dueLabel}) แต่ระบบยังไม่ได้ตั้งลูกหนี้งวด — `
        : `งวดนี้ยังไม่ถึงวันครบกำหนด (${dueLabel}) ระบบจึงยังไม่ได้ตั้งลูกหนี้งวด — `;
      const guidance =
        input.method === 'QR'
          ? 'แผงนี้จึงยังแสดงรายการบัญชีของยอดบางส่วนไม่ได้ การส่ง QR ยอดนี้ยังทำได้ตามเดิม'
          : dueReached
            ? 'หน้านี้จึงยังบันทึกรับชำระบางส่วนไม่ได้ กรุณารับชำระเต็มงวด หรือติดต่อฝ่ายบัญชีให้ตรวจสอบงวดนี้ก่อนรับชำระบางส่วน'
            : 'หน้านี้จึงยังบันทึกรับชำระบางส่วนไม่ได้ กรุณารับชำระเต็มงวด หรือรอให้ถึงวันครบกำหนดแล้วจึงรับชำระบางส่วน';
      throw new BadRequestException(situation + guidance);
    }

    // ── RESCHEDULE / ปรับดิว — collect-first preview (owner 2026-07-02) ────────
    // Mirrors RescheduleCollectService.executeWithCollect: the JE that posts AT
    // CONFIRM (เงินไม่เข้า ดิวไม่เลื่อน) —
    //   6a (SPLIT):  Dr deposit (fee+ค่าปรับ) / Cr 21-1103 fee / Cr 42-1103 ค่าปรับ
    //   6b (SINGLE): Dr deposit ค่าปรับ / Cr 42-1103 ค่าปรับ (fee รวมงวดถัดไป)
    // ค่าปรับ (netLateFee) comes from the wizard/overlay quote; nothing owed → no lines.
    //
    // NOTE (owner correction 2026-07-09): 6b now means จ่ายทั้งก้อนวันนี้ — the UI
    // previews SINGLE as a normal OVERPAY_ADVANCE receipt instead of this branch.
    // The SINGLE case below is kept ONLY for legacy in-flight QR links (frozen
    // fixedQuote, late-fee-only) whose webhook still books the old-style JE.
    if (input.case === 'RESCHEDULE') {
      const days = input.daysToShift ?? 0;
      const monthlyPayment = new Prisma.Decimal(c.monthlyPayment.toString());
      // Reschedule fee = installmentTotal / 30 × daysToShift, rounded UP to a whole
      // baht (owner policy 2026-06 — ปัดเศษขึ้นเต็มบาท). Matches RescheduleService.execute.
      const rescheduleFee =
        days > 0
          ? monthlyPayment.div(30).times(days).toDecimalPlaces(0, Prisma.Decimal.ROUND_UP)
          : zero;

      const isSplit = input.splitMode === 'SPLIT';
      const feePortion = isSplit ? rescheduleFee : zero;
      const collectTotal = feePortion.plus(netLateFee);

      if (collectTotal.gt(zero)) {
        rawLines.push({
          code: input.depositAccountCode,
          dr: collectTotal,
          cr: zero,
          description: 'รับเงินปรับดิว',
        });
        if (feePortion.gt(zero)) {
          rawLines.push({
            code: '21-1103',
            dr: zero,
            cr: feePortion,
            // M-1: must match the POSTED line verbatim — RescheduleCollectService
            // credits 21-1103 with 'เงินรับล่วงหน้างวดสุดท้าย — ค่าธรรมเนียมปรับดิว (6a)'
            // since the park-at-last-installment directive (2026-08-16). This file's
            // contract is preview == posted.
            description: 'เงินรับล่วงหน้างวดสุดท้าย — ค่าธรรมเนียมปรับดิว (6a)',
          });
        }
        if (netLateFee.gt(zero)) {
          rawLines.push({
            code: '42-1103',
            dr: zero,
            cr: netLateFee,
            description: 'ค่าปรับชำระล่าช้า (เก็บตอนปรับดิว)',
          });
        }
      }

      // Resolve CoA names
      const codes = [...new Set(rawLines.map((l) => l.code))];
      const coaRows = await this.prisma.chartOfAccount.findMany({
        where: { code: { in: codes } },
        select: { code: true, name: true },
      });
      const nameMap = new Map(coaRows.map((r) => [r.code, r.name]));

      let totalDebit = zero;
      let totalCredit = zero;
      for (const l of rawLines) {
        totalDebit = totalDebit.plus(l.dr);
        totalCredit = totalCredit.plus(l.cr);
      }
      const isBalanced = totalDebit.toFixed(2) === totalCredit.toFixed(2);

      const rescheduleBlocks = buildPreviewBlocks({
        liveLines: rawLines.map((l) => ({
          accountCode: l.code,
          accountName: nameMap.get(l.code) ?? l.code,
          debit: l.dr.toFixed(2),
          credit: l.cr.toFixed(2),
          description: l.description,
        })),
      });
      return {
        lines: rescheduleBlocks.lines,
        subtotals: rescheduleBlocks.subtotals,
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
        isBalanced,
        rescheduleFeeDisplay: rescheduleFee.toFixed(2),
      };
    }

    // Use the same accrual basis and prior receipt history as posting. The billed
    // amount can be rounded to whole baht; it is not the GL receivable balance.
    const { installmentTotal } = computeInstallmentBreakdown({
      financedAmount: c.financedAmount.toString(),
      storeCommission: c.storeCommission?.toString() ?? null,
      interestTotal: c.interestTotal.toString(),
      vatAmount: c.vatAmount?.toString() ?? null,
      totalMonths: c.totalMonths,
      installmentNo: inst.installmentNo,
    });
    const { priorPrincipalCleared, priorLateFeeBooked } = await reconstructPriorCleared(
      this.prisma,
      inst.id,
      installmentTotal,
    );

    // ── PARTIAL case: mirror PaymentReceiptTemplate exactly ─────────────────
    // Fee-first split (owner 2026-07-02): Cr 42-1103 = late fee owed, Cr 11-2103 =
    // remainder. Uses the SAME pure pipeline the posting runs (installmentTotal from
    // computeInstallmentBreakdown → reconstructPriorCleared → splitReceipt →
    // buildReceiptLines) so a follow-up receipt whose fee is already booked
    // previews principal-only — no double 42-1103.
    if (input.case === 'PARTIAL') {
      // Mirror recordPayment's guard (orchestrator ~line 325): waiver-on-partial is
      // rejected at save, so the preview must not render a plausible net-fee JE
      // (it would drop the Dr 52-1105 gross-waiver leg and mislead the cashier).
      if (lateFeeWaivedAmount.gt(zero)) {
        throw new BadRequestException(
          'อนุโลมค่าปรับทำได้เฉพาะตอนชำระปิดงวด (ไม่รองรับจ่ายบางส่วน)',
        );
      }
      const amountReceived = new Prisma.Decimal(input.amountReceived.toString());
      const split = splitReceipt({
        delta: amountReceived,
        installmentTotal,
        // recordPayment rejects waiver-on-partial, so netLateFee == gross here;
        // clamped anyway for a mid-edit preview where both fields are filled.
        lateFee: netLateFee,
        priorPrincipalCleared,
        priorLateFeeBooked,
        advanceConsume: zero, // PARTIAL never auto-consumes advance (orchestrator NORMAL-only)
        advanceCredit: zero,
        isFinalReceipt: false,
      });
      const receiptLines = buildReceiptLines({
        split,
        debitAccountCode: input.depositAccountCode,
        delta: amountReceived,
        advanceConsume: zero,
        advanceCredit: zero,
        lateFeeWaived: zero,
        overpayCode: this.accountRoleService?.tryCode('adj_overpay') ?? '53-1503',
        underpayCode: this.accountRoleService?.tryCode('adj_underpay') ?? '52-1104',
      });
      for (const l of receiptLines) {
        rawLines.push({
          code: l.accountCode,
          dr: l.dr,
          cr: l.cr,
          description: l.description ?? '',
        });
      }

      const codes = [...new Set(rawLines.map((l) => l.code))];
      const coaRows = await this.prisma.chartOfAccount.findMany({
        where: { code: { in: codes } },
        select: { code: true, name: true },
      });
      const nameMap = new Map(coaRows.map((r) => [r.code, r.name]));
      let totalDebit = zero;
      let totalCredit = zero;
      for (const l of rawLines) {
        totalDebit = totalDebit.plus(l.dr);
        totalCredit = totalCredit.plus(l.cr);
      }
      const partialBlocks = buildPreviewBlocks({
        liveLines: rawLines.map((l) => ({
          accountCode: l.code,
          accountName: nameMap.get(l.code) ?? l.code,
          debit: l.dr.toFixed(2),
          credit: l.cr.toFixed(2),
          description: l.description,
        })),
      });
      return {
        lines: partialBlocks.lines,
        subtotals: partialBlocks.subtotals,
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
        isBalanced: totalDebit.toFixed(2) === totalCredit.toFixed(2),
      };
    }

    // ── Normal / Overpay / Underpay / EarlyPayoff (existing logic continues) ─
    const amountReceived = new Prisma.Decimal(input.amountReceived.toString());
    const payment = await this.prisma.payment.findFirst({
      where: { contractId: input.contractId, installmentNo: input.installmentNo, deletedAt: null },
      select: { amountDue: true, amountPaid: true },
    });
    if (!payment) throw new NotFoundException('ไม่พบงวดชำระ');

    // ── Advance balance split (mirror recordPayment §Task 4) ────────────────
    // Owed = installment + NET late fee (gross − waived); the waived portion books to
    // Dr 52-1105, not collected in cash.
    const advanceBalance = new Prisma.Decimal((c.advanceBalance ?? 0).toString());
    // Park-at-last-installment (owner directive 2026-08-16): Contract.
    // rescheduleAdvanceBalance is a separate bucket relieved ONLY on the
    // contract's LAST installment. Mirror the orchestrator's gate exactly so
    // the preview never disagrees with what save() posts.
    const parkBalance = new Prisma.Decimal((c.rescheduleAdvanceBalance ?? 0).toString());
    const isLastInstallmentPreview = inst.installmentNo === c.totalMonths;
    // Advance allocation follows the billed obligation, exactly as recordPayment:
    // amountDue + net fee - amountPaid. GL cents are handled by rounding below.
    const remaining = new Prisma.Decimal(payment.amountDue.toString())
      .plus(netLateFee)
      .minus(new Prisma.Decimal(payment.amountPaid.toString()));
    const overage = amountReceived.minus(remaining);
    let previewAdvCredit = zero;
    let previewAdvConsume = zero;
    let previewParkConsume = zero;

    if (overage.gt(new Prisma.Decimal('1.00')) && input.case === 'OVERPAY_ADVANCE') {
      previewAdvCredit = overage;
    } else if (
      (input.consumeAdvance ?? true) &&
      amountReceived.lt(remaining) &&
      (input.case === undefined ||
        input.case === 'NORMAL' ||
        input.case === 'OVERPAY' ||
        input.case === 'UNDERPAY') &&
      (advanceBalance.gt(zero) || (isLastInstallmentPreview && parkBalance.gt(zero)))
    ) {
      // Mirror orchestrator: only auto-consume when the credit checkbox is on.
      const gap = remaining.minus(amountReceived);
      if (advanceBalance.gt(zero)) {
        previewAdvConsume = Prisma.Decimal.min(advanceBalance, gap);
      }
      // Generic advance first, park bucket only for whatever gap remains — and
      // only on the contract's last installment.
      if (isLastInstallmentPreview && parkBalance.gt(zero)) {
        const gapAfterGeneric = gap.minus(previewAdvConsume);
        if (gapAfterGeneric.gt(zero)) {
          previewParkConsume = Prisma.Decimal.min(parkBalance, gapAfterGeneric);
        }
      }
    }
    // Generic + park both clear the SAME GL account (21-1103) — the split is an
    // application-level bookkeeping distinction only, not a GL-level one.
    const previewTotalConsume = previewAdvConsume.plus(previewParkConsume);

    // Check the billed obligation before applying GL rounding. A 1.20 baht
    // customer shortage must not become an allowed 0.87 baht ledger adjustment.
    const shortage = remaining.minus(amountReceived).minus(previewTotalConsume);
    if (shortage.gt('1.00')) {
      throw new BadRequestException(
        `จำนวนเงินน้อยกว่ายอดที่ต้องชำระ (ยอดที่ต้องชำระ ${remaining.toFixed(2)} บาท) — เลือก case 'PARTIAL' เพื่อบันทึกเป็นจ่ายบางส่วน`,
      );
    }

    const split = splitReceipt({
      delta: amountReceived,
      installmentTotal,
      lateFee: netLateFee,
      priorPrincipalCleared,
      priorLateFeeBooked,
      advanceConsume: previewTotalConsume,
      advanceCredit: previewAdvCredit,
      isFinalReceipt: true,
    });
    if (split.overpayRounding.gt('1.00') || split.principalRemainingAfter.gt('1.00')) {
      throw new BadRequestException('ยอดรับชำระต่างจากลูกหนี้คงเหลือเกินเกณฑ์ปัดเศษ 1.00 บาท');
    }

    // ── ตั้งลูกหนี้งวด ณ วันรับเงิน (D2, 2026-09-28 · R9 + R12 + R14 + R17, 2026-09-29) ─
    // ถามกติกาตัวเดียวกับ PaymentReceiptTemplate หลังคำนวณ split เหมือนกัน. สถานะของสัญญาตอนขอ
    // preview คือสถานะก่อนรับเงิน. ใบนี้ทำให้งวดชำระครบหรือไม่:
    //   - บันทึกที่หน้าจอ (เงินสด/โอน/บัตร): ใช่เสมอในสาขานี้ — ยอดบางส่วนถูกด่านข้างบนปฏิเสธไปแล้ว
    //   - เลือกชำระผ่าน QR: รายการถูกบันทึกเมื่อผู้ให้บริการยืนยันว่าเงินเข้า และเส้นทางนั้นบันทึกแบบ
    //     "รับบางส่วน" เสมอ (PaySolutionsConfirmationService → recordPayment(…, 'PARTIAL', …)) —
    //     ไม่หักเครดิตของลูกค้า และเป็นใบที่ทำให้งวดชำระครบเฉพาะเมื่อยอด QR ครบ `remaining`
    //     (ยอดเรียกเก็บ + ค่าปรับสุทธิ − ที่ชำระแล้ว). ยอด QR ที่หน้าจอหักเครดิตออกให้แล้วจึงไม่ครบ
    //     → ไม่มี 2A ตอนเงินเข้า
    // เมื่อจะตั้ง: แสดงบรรทัดที่จะลงจริงจากตัวสร้างเดียวกับ InstallmentAccrual2ATemplate และวันที่จาก
    // resolveAccrualPostingDate ตัวเดียวกัน.
    const viaQr = input.method === 'QR';
    const settlesInstallment = viaQr ? amountReceived.gte(remaining) : true;
    const accrualDecision = decideAccrueAtReceipt({
      alreadyAccrued: !!inst.accrualJournalEntryId,
      contractStatusBeforeReceipt: c.status,
      isFinalReceipt: settlesInstallment,
      principalRemainingAfter: split.principalRemainingAfter,
    });
    const isConsolidated = accrualDecision === 'ACCRUE'; // 2A จะลงพร้อมการรับชำระนี้
    // QR ที่หน้าจอหักเครดิตออกให้แล้ว (R14 + R17): เงินที่เข้าจะถูกบันทึกเป็นการรับบางส่วนโดยไม่หักเครดิต —
    // บรรทัดที่คำนวณไว้ข้างบน (หักเครดิต + ล้างลูกหนี้เต็มงวด) จึงไม่ใช่สิ่งที่จะลงจริง. ทำแบบเดียวกับด่าน
    // จ่ายบางส่วนของโหมด QR: ตอบด้วยประโยคเดียว ไม่คืนบรรทัดรายการบัญชี (ปุ่มส่ง QR ไม่ใช้ผล preview
    // เป็นด่าน การส่ง QR ยอดนี้ยังทำได้). ประโยคชี้เฉพาะสิ่งที่มีบนหน้ารับชำระ: กล่อง "มีเครดิตคงเหลือ"
    // แสดงทุกครั้งที่ลูกค้ามีเครดิตที่หักได้ ซึ่งเป็นเงื่อนไขเดียวกับที่ทำให้ previewTotalConsume > 0 —
    // เมื่อนำเครื่องหมายออก หน้าจอเติมยอดเต็มให้เอง.
    // งวดที่ตั้งลูกหนี้งวดแล้ว (ALREADY_ACCRUED) และสัญญาที่ไม่ตั้งลูกหนี้งวด ไม่เข้าเงื่อนไขนี้ — ได้ผลเดิม
    if (
      viaQr &&
      !settlesInstallment &&
      accrualDecision === 'PARTIAL_RECEIPT' &&
      previewTotalConsume.gt(zero)
    ) {
      // ยอดเงินในข้อความ: ทศนิยม 2 ตำแหน่ง คั่นหลักพันด้วยจุลภาค (แบบเดียวกับยอดในแผงรายการบัญชีและบน
      // ปุ่มส่ง QR) — จัดรูปจากสตริงของ Decimal ไม่แปลงเป็น number
      const formatAmount = (amount: Prisma.Decimal): string =>
        amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      throw new BadRequestException(
        `การชำระผ่าน QR ไม่หักเครดิตคงเหลือของลูกค้า — ยอด QR ${formatAmount(amountReceived)} บาท จึงยังไม่ครบยอดที่ต้องชำระของงวดนี้ (${formatAmount(remaining)} บาท) ` +
          'เมื่อเงินเข้า ระบบจะบันทึกเป็นการรับชำระบางส่วน และยังไม่ตั้งลูกหนี้งวด (2A) ' +
          'หากต้องการให้งวดนี้ชำระครบเมื่อเงินเข้า ให้นำเครื่องหมายถูกออกจากกล่อง "มีเครดิตคงเหลือ" เพื่อส่ง QR เต็มยอด',
      );
    }
    const pendingAccrual = isConsolidated
      ? buildAccrual2ALines({
          financedAmount: c.financedAmount.toString(),
          storeCommission: c.storeCommission?.toString() ?? null,
          interestTotal: c.interestTotal.toString(),
          vatAmount: c.vatAmount?.toString() ?? null,
          totalMonths: c.totalMonths,
          installmentNo: inst.installmentNo,
        })
      : null;
    const receiptDate = input.paidDate ? new Date(input.paidDate) : new Date();
    const accrualPostedAt = pendingAccrual
      ? resolveAccrualPostingDate(inst.dueDate, receiptDate)
      : null;
    // Accrual-mode classification for the UI chip — ตามวันที่ที่ 2A จะถูกลงจริง:
    //   2B_ONLY       — ไม่มี 2A ที่จะลงพร้อมการรับชำระนี้ (ลงไปแล้ว · สัญญาที่ไม่ตั้งลูกหนี้งวด ·
    //                   QR ที่ยอดยังไม่ครบยอดที่ต้องชำระของงวด)
    //   PAYING_AHEAD  — 2A จะลงวันที่รับเงิน (รับก่อนวันครบกำหนด)
    //   BACKFILL      — 2A จะลงวันครบกำหนด (รับในหรือหลังวันครบกำหนด)
    const accrualMode: '2B_ONLY' | 'CONSOLIDATED_PAYING_AHEAD' | 'CONSOLIDATED_BACKFILL' =
      !accrualPostedAt
        ? '2B_ONLY'
        : accrualPostedAt.getTime() === inst.dueDate.getTime()
          ? 'CONSOLIDATED_BACKFILL'
          : 'CONSOLIDATED_PAYING_AHEAD';
    const pendingAccrualRows = (pendingAccrual?.lines ?? []).map((l) => ({
      accountCode: l.accountCode,
      debit: l.dr,
      credit: l.cr,
      description: l.description as string | null,
    }));
    // Share the posting allocation, including fee-first receipts, current
    // waivers, and rounding alongside advance consumption/credit.
    for (const line of buildReceiptLines({
      split,
      debitAccountCode: input.depositAccountCode,
      delta: amountReceived,
      advanceConsume: previewTotalConsume,
      advanceCredit: previewAdvCredit,
      lateFeeWaived: lateFeeWaivedAmount,
      overpayCode: this.accountRoleService?.tryCode('adj_overpay') ?? '53-1503',
      underpayCode: this.accountRoleService?.tryCode('adj_underpay') ?? '52-1104',
    })) {
      rawLines.push({ code: line.accountCode, dr: line.dr, cr: line.cr, description: line.description ?? '' });
    }

    // 2B_ONLY: fetch the already-POSTED 2A accrual context (read-only). Includes
    // BOTH the accrual JE (by entryNumber == stamped accrualJournalEntryId) AND any
    // advance-consume-on-accrual JE (Dr 21-1103 / Cr 11-2103, referenceId-tagged by
    // InstallmentAccrual2ATemplate) so the 2A block truthfully reflects the real
    // 11-2103 state. `status:'POSTED'` excludes a VOIDED accrual (void keeps
    // deletedAt null in this codebase — see shop-collect void regression test).
    // The mockup case has no consume JE → 2A = the clean 2,115.00 accrual.
    let accrualLineRows: {
      accountCode: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      description: string | null;
    }[] = [];
    if (!isConsolidated && inst.accrualJournalEntryId) {
      const accrualEntries = await this.prisma.journalEntry.findMany({
        where: {
          status: 'POSTED',
          deletedAt: null,
          OR: [
            { entryNumber: inst.accrualJournalEntryId },
            { referenceId: `${inst.id}:${ADVANCE_CONSUME_ON_ACCRUAL_FLOW}` },
            // I-4 (final review 2026-08-16): the LAST installment can also carry a
            // park-bucket relief JE (Dr 21-1103 / Cr 11-2103, ค่าปรับดิวพักงวดสุดท้าย).
            // Omitting it made the 2A block show the receivable as fully outstanding
            // when the GL had already cleared part/all of it. Reference suffixes come
            // from the same constants InstallmentAccrual2ATemplate stamps.
            { referenceId: `${inst.id}:${RESCHEDULE_PARK_CONSUME_FLOW}` },
          ],
        },
        include: { lines: { where: { deletedAt: null } } },
        orderBy: { createdAt: 'asc' },
      });
      accrualLineRows = accrualEntries.flatMap((e) => e.lines);
    } else if (isConsolidated) {
      // ยังไม่ตั้งลูกหนี้งวด — แสดงบรรทัด 2A ที่การบันทึกนี้จะลง (posted: false)
      accrualLineRows = pendingAccrualRows;
    }

    // Resolve account names from CoA (cover both live + accrual codes in one query)
    const codes = [
      ...new Set([...rawLines.map((l) => l.code), ...accrualLineRows.map((l) => l.accountCode)]),
    ];
    const coaRows = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: codes } },
      select: { code: true, name: true },
    });
    const nameMap = new Map(coaRows.map((r) => [r.code, r.name]));

    // Compute totals over the LIVE (2B) lines — these are what the save posts now,
    // so they drive the submit gate's isBalanced (unchanged semantics).
    let totalDebit = zero;
    let totalCredit = zero;
    for (const l of rawLines) {
      totalDebit = totalDebit.plus(l.dr);
      totalCredit = totalCredit.plus(l.cr);
    }

    const blocks = buildPreviewBlocks({
      accrualPosted: !isConsolidated,
      liveLines: rawLines.map((l) => ({
        accountCode: l.code,
        accountName: nameMap.get(l.code) ?? l.code,
        debit: l.dr.toFixed(2),
        credit: l.cr.toFixed(2),
        description: l.description,
      })),
      accrualLines: accrualLineRows.map((l) => ({
        accountCode: l.accountCode,
        accountName: nameMap.get(l.accountCode) ?? l.accountCode,
        debit: new Prisma.Decimal(l.debit.toString()).toFixed(2),
        credit: new Prisma.Decimal(l.credit.toString()).toFixed(2),
        description: l.description ?? '',
      })),
    });

    // ยอดรวม/สมดุลของใบรับชำระ (2B) คงความหมายเดิม; 2A ที่จะลงใหม่ต้องสมดุลด้วยจึงจะให้บันทึก
    const isBalanced =
      totalDebit.toFixed(2) === totalCredit.toFixed(2) &&
      (isConsolidated ? (blocks.accrual2A?.subtotal.balanced ?? true) : true);

    return {
      lines: blocks.lines,
      accrual2A: blocks.accrual2A,
      subtotals: blocks.subtotals,
      totalDebit: totalDebit.toFixed(2),
      totalCredit: totalCredit.toFixed(2),
      isBalanced,
      accrualMode,
      dueDate: inst.dueDate.toISOString(),
      ...(accrualPostedAt ? { accrualPostedAt: accrualPostedAt.toISOString() } : {}),
    };
  }
}
