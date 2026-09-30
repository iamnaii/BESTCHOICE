import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountRoleService } from '../../journal/account-role.service';
import { computeInstallmentBreakdown } from '../../journal/compute-installment-breakdown';
import { splitReceipt } from '../../journal/split-receipt';
import { buildReceiptLines } from '../../journal/build-receipt-lines';
import {
  Accrual2AKind,
  Accrual2APartResult,
  AccruedSoFar,
  accrual2AInputOf,
  accruedSoFarOf,
  buildPartialAccrual2ALines,
  buildRemainderAccrual2ALines,
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

type AccrualMode = '2B_ONLY' | 'CONSOLIDATED_PAYING_AHEAD' | 'CONSOLIDATED_BACKFILL';

type InstallmentWithContract = Prisma.InstallmentScheduleGetPayload<{
  include: { contract: true };
}>;

/** ผลของ previewJournal (บล็อก 2A / 2B + ข้อมูลของรายการ 2A ที่จะลง). */
export interface PreviewJournalResult {
  lines: PreviewTaggedLine[];
  accrual2A?: { lines: PreviewTaggedLine[]; subtotal: BlockSubtotal };
  subtotals: { '2A'?: BlockSubtotal; '2B': BlockSubtotal };
  totalDebit: string;
  totalCredit: string;
  isBalanced: boolean;
  rescheduleFeeDisplay?: string;
  /**
   * 2B_ONLY: ไม่มีรายการ 2A ที่จะลงพร้อมการรับชำระนี้ — งวดนี้ตั้งลูกหนี้งวดไปแล้ว · สถานะสัญญาเป็นสถานะ
   *   ที่รอบกลางคืนไม่ดูแล · หรือใบบางส่วนตั้งแต่วันครบกำหนด — การบันทึกลงเฉพาะใบรับชำระ.
   * CONSOLIDATED_PAYING_AHEAD: รายการ 2A จะลงวันที่รับเงิน (รับก่อนวันครบกำหนด) แล้วลงใบรับชำระ
   *   (2 รายการ ธุรกรรมเดียวกัน).
   * CONSOLIDATED_BACKFILL: รายการ 2A จะลงวันครบกำหนด (รับในหรือหลังวันครบกำหนด — รอบกลางคืนตกหล่น)
   *   แล้วลงใบรับชำระ.
   * (ชื่อค่าคงเดิมเพื่อไม่เปลี่ยนสัญญา API — ระบบไม่เคยรวม 2A+2B เป็นรายการเดียว)
   */
  accrualMode?: AccrualMode;
  dueDate?: string;
  /** วันที่ที่รายการ 2A จะถูกลง (ISO) — มีเฉพาะเมื่อมีรายการ 2A ที่จะลงพร้อมการรับชำระนี้. */
  accrualPostedAt?: string;
  /** รายการ 2A ที่จะลง: ทั้งงวด (FULL) / เท่ายอดที่รับ (PARTIAL) / ส่วนที่เหลือของงวด (REMAINDER) */
  accrualPortion?: Accrual2AKind;
  /** ยอด Dr 11-2103 ของรายการ 2A ที่จะลง (2 ตำแหน่ง) */
  accrualAmount?: string;
  /** ยอดที่ตั้งลูกหนี้งวดไปแล้วของงวดก่อนรายการนี้ (2 ตำแหน่ง) */
  accruedBefore?: string;
}

/**
 * ช่องของรายการ 2A ที่ "จะลงพร้อมการรับชำระนี้" ใน preview — ใช้ร่วมกันทั้งสาขาจ่ายบางส่วนและสาขาปกติ.
 * `pending` = null → ไม่มี 2A ที่จะลง (2B_ONLY).
 */
function pendingAccrualFields(
  pending: Accrual2APartResult | null,
  dueDate: Date,
  receiptDate: Date,
  accruedBefore: Prisma.Decimal,
): {
  accrualMode: AccrualMode;
  accrualPostedAt: Date | null;
  extra: { accrualPortion?: Accrual2AKind; accrualAmount?: string; accruedBefore?: string };
} {
  if (!pending) return { accrualMode: '2B_ONLY', accrualPostedAt: null, extra: {} };
  const accrualPostedAt = resolveAccrualPostingDate(dueDate, receiptDate);
  return {
    // ตามวันที่ที่ 2A จะถูกลงจริง: วันที่รับเงิน (ก่อนครบกำหนด) / วันครบกำหนด (รอบกลางคืนตกหล่น)
    accrualMode:
      accrualPostedAt.getTime() === dueDate.getTime()
        ? 'CONSOLIDATED_BACKFILL'
        : 'CONSOLIDATED_PAYING_AHEAD',
    accrualPostedAt,
    extra: {
      accrualPortion: pending.kind,
      accrualAmount: pending.portion.total.toFixed(2),
      accruedBefore: accruedBefore.toFixed(2),
    },
  };
}

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
   * ลงวันครบกำหนด). ตั้งแต่ ก1 (29/09/2569) รายการที่จะลงอาจเป็นทั้งงวด / เท่ายอดที่รับ (ใบบางส่วนก่อนวันครบ
   * กำหนด) / ส่วนที่เหลือ — บอกด้วย `accrualPortion` + `accrualAmount` + `accruedBefore`.
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
  }): Promise<PreviewJournalResult> {
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

    // วันที่รับเงินตามที่การบันทึกจะใช้ตัดสินและลง 2A: หน้าจอ (เงินสด/โอน/บัตร) = วันที่ที่เลือก · QR = เวลาที่
    // ผู้ให้บริการยืนยันว่าเงินเข้า ซึ่งเร็วที่สุดคือตอนนี้
    const viaQr = input.method === 'QR';
    const receiptDate = !viaQr && input.paidDate ? new Date(input.paidDate) : new Date();
    const accruedBefore = accruedSoFarOf(inst);

    // ด่าน "จ่ายบางส่วนของงวดที่ถึงวันครบกำหนดแล้วแต่ยังไม่ตั้งลูกหนี้งวด" (คำตัดสินผู้คุมงาน R2 + R9 ·
    // แก้ตาม ก1 2026-09-30): ใบบางส่วน**ก่อน**วันครบกำหนดตั้ง 2A เท่ายอดที่รับแล้ว — ไม่มีด่าน. ใบบางส่วน
    // ตั้งแต่วันครบกำหนดของงวดที่ยังไม่มี 2A (รอบกลางคืนตกหล่น) ยังไม่ลง 2A จึงยังเครดิต 11-2103 โดยไม่มี
    // รายการรองรับ — ด่านนี้คงอยู่เฉพาะกรณีนั้น. "ถึงวันครบกำหนดแล้ว" ตัดสินตามวันปฏิทินไทย ณ วันที่รับเงินข้างบน
    // (วันครบกำหนดเอง = ถึงแล้ว — ยังไม่ใช่เกินกำหนด). เมื่อเลือกชำระผ่าน QR หน้าจอไม่ใช้ผล preview เป็นด่าน —
    // ข้อความของโหมดนั้นจึงบอกเพียงว่าแผงนี้แสดงรายการบัญชีไม่ได้.
    // (RESCHEDULE no longer needs this guard — its collect-first JE touches only
    //  21-1103 / 42-1103, never 11-2103; the old bundled-6b preview that credited
    //  11-2103 was replaced by the collect semantics on 2026-07-02.)
    if (
      !inst.accrualJournalEntryId &&
      input.case === 'PARTIAL' &&
      isDueDateReached(inst.dueDate, receiptDate)
    ) {
      const guidance = viaQr
        ? 'แผงนี้จึงยังแสดงรายการบัญชีของยอดบางส่วนไม่ได้ การส่ง QR ยอดนี้ยังทำได้ตามเดิม'
        : 'หน้านี้จึงยังบันทึกรับชำระบางส่วนไม่ได้ กรุณารับชำระเต็มงวด หรือติดต่อฝ่ายบัญชีให้ตรวจสอบงวดนี้ก่อนรับชำระบางส่วน';
      // งวดที่ใบบางส่วนก่อนวันครบกำหนดตั้งไปแล้วบางส่วน — ถ้อยคำเดียวกับป้ายของแผง ("ยังตั้งลูกหนี้งวดไม่ครบ")
      const accrualState = accruedBefore.amount.gt(zero)
        ? 'แต่ระบบยังตั้งลูกหนี้งวดไม่ครบ'
        : 'แต่ระบบยังไม่ได้ตั้งลูกหนี้งวด';
      throw new BadRequestException(
        `งวดนี้ถึงวันครบกำหนดแล้ว (${formatDateShort(inst.dueDate)}) ${accrualState} — ` + guidance,
      );
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
    const { installmentTotal } = computeInstallmentBreakdown(
      accrual2AInputOf(c, inst.installmentNo),
    );
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
      return this.previewPartialReceipt({
        inst,
        amountReceived: new Prisma.Decimal(input.amountReceived.toString()),
        depositAccountCode: input.depositAccountCode,
        lateFeeWaivedAmount,
        netLateFee,
        installmentTotal,
        priorPrincipalCleared,
        priorLateFeeBooked,
        receiptDate,
        accruedBefore,
      });
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

    // QR ที่ยอดยังไม่ครบยอดที่ต้องชำระของงวด และไม่มีเครดิตให้หัก (คำตัดสินผู้คุมงาน 2026-09-30 ข้อ 3): เงินที่เข้า
    // ทาง QR ถูกบันทึกแบบ "รับบางส่วน" เสมอ (PaySolutionsConfirmationService → recordPayment(…, 'PARTIAL', …)) —
    // ไม่ปิดส่วนขาดด้วย 52-1104 และก่อนวันครบกำหนดลง 2A เท่ายอดที่รับ. แสดงสิ่งที่จะลงจริงด้วยสาขาเดียวกับ
    // case 'PARTIAL' · ยอด QR ที่หน้าจอหักเครดิตออกให้แล้ว (มียอดหัก) ยังตอบด้วยประโยค R17 ข้างล่างตามเดิม
    if (viaQr && amountReceived.lt(remaining) && previewTotalConsume.isZero()) {
      return this.previewPartialReceipt({
        inst,
        amountReceived,
        depositAccountCode: input.depositAccountCode,
        lateFeeWaivedAmount,
        netLateFee,
        installmentTotal,
        priorPrincipalCleared,
        priorLateFeeBooked,
        receiptDate,
        accruedBefore,
      });
    }

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

    // ── ตั้งลูกหนี้งวด ณ วันรับเงิน (D2, 2026-09-28 · R9 + R12 + R14 + R17 · ก1, 2026-09-29) ─
    // ถามกติกาตัวเดียวกับ PaymentReceiptTemplate หลังคำนวณ split เหมือนกัน. สถานะของสัญญาตอนขอ
    // preview คือสถานะก่อนรับเงิน. ใบนี้ทำให้งวดชำระครบหรือไม่:
    //   - บันทึกที่หน้าจอ (เงินสด/โอน/บัตร): ใช่เสมอในสาขานี้ — ยอดบางส่วนใช้ case 'PARTIAL' (สาขาข้างบน)
    //   - เลือกชำระผ่าน QR: รายการถูกบันทึกเมื่อผู้ให้บริการยืนยันว่าเงินเข้า และเส้นทางนั้นบันทึกแบบ
    //     "รับบางส่วน" เสมอ (PaySolutionsConfirmationService → recordPayment(…, 'PARTIAL', …)) —
    //     ไม่หักเครดิตของลูกค้า และเป็นใบที่ทำให้งวดชำระครบเฉพาะเมื่อยอด QR ครบ `remaining`
    //     (ยอดเรียกเก็บ + ค่าปรับสุทธิ − ที่ชำระแล้ว)
    // เมื่อจะตั้ง: แสดงบรรทัดที่จะลงจริงจากตัวสร้างเดียวกับ InstallmentAccrual2ATemplate (ส่วนที่เหลือของงวด —
    // งวดที่ยังไม่เคยตั้ง = ทั้งงวด) และวันที่จาก resolveAccrualPostingDate ตัวเดียวกัน.
    const settlesInstallment = viaQr ? amountReceived.gte(remaining) : true;
    const accrualDecision = decideAccrueAtReceipt({
      alreadyAccrued: !!inst.accrualJournalEntryId,
      contractStatusBeforeReceipt: c.status,
      isFinalReceipt: settlesInstallment,
      principalRemainingAfter: split.principalRemainingAfter,
      principalCleared: split.principalCleared,
      dueDateReached: isDueDateReached(inst.dueDate, receiptDate),
    });
    const isConsolidated = accrualDecision === 'ACCRUE'; // 2A จะลงพร้อมการรับชำระนี้
    // QR ที่หน้าจอหักเครดิตออกให้แล้ว (R14 + R17): เงินที่เข้าจะถูกบันทึกเป็นการรับบางส่วนโดยไม่หักเครดิต —
    // บรรทัดที่คำนวณไว้ข้างบน (หักเครดิต + ล้างลูกหนี้เต็มงวด) จึงไม่ใช่สิ่งที่จะลงจริง. ตอบด้วยประโยคเดียว
    // ไม่คืนบรรทัดรายการบัญชี (ปุ่มส่ง QR ไม่ใช้ผล preview เป็นด่าน). ประโยคบอกผลต่อการตั้งลูกหนี้งวดตามกติกา
    // เดียวกับใบบางส่วน: ก่อนวันครบกำหนด = ตั้งเท่ายอดที่รับ (ก1) · ตั้งแต่วันครบกำหนด = ยังไม่ตั้ง.
    // งวดที่ตั้งลูกหนี้งวดแล้ว (ALREADY_ACCRUED) และสัญญาที่ไม่ตั้งลูกหนี้งวด ไม่เข้าเงื่อนไขนี้ — ได้ผลเดิม
    if (
      viaQr &&
      !settlesInstallment &&
      (accrualDecision === 'PARTIAL_RECEIPT' || accrualDecision === 'ACCRUE_RECEIVED') &&
      previewTotalConsume.gt(zero)
    ) {
      // ยอดเงินในข้อความ: ทศนิยม 2 ตำแหน่ง คั่นหลักพันด้วยจุลภาค (แบบเดียวกับยอดในแผงรายการบัญชีและบน
      // ปุ่มส่ง QR) — จัดรูปจากสตริงของ Decimal ไม่แปลงเป็น number
      const formatAmount = (amount: Prisma.Decimal): string =>
        amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      throw new BadRequestException(
        `การชำระผ่าน QR ไม่หักเครดิตคงเหลือของลูกค้า — ยอด QR ${formatAmount(amountReceived)} บาท จึงยังไม่ครบยอดที่ต้องชำระของงวดนี้ (${formatAmount(remaining)} บาท) ` +
          (accrualDecision === 'ACCRUE_RECEIVED'
            ? 'เมื่อเงินเข้า ระบบจะบันทึกเป็นการรับชำระบางส่วน และตั้งลูกหนี้งวด (2A) เท่ายอดที่รับ '
            : 'เมื่อเงินเข้า ระบบจะบันทึกเป็นการรับชำระบางส่วน และยังไม่ตั้งลูกหนี้งวด (2A) ') +
          'หากต้องการให้งวดนี้ชำระครบเมื่อเงินเข้า ให้นำเครื่องหมายถูกออกจากกล่อง "มีเครดิตคงเหลือ" เพื่อส่ง QR เต็มยอด',
      );
    }
    const pendingAccrual = isConsolidated
      ? buildRemainderAccrual2ALines(accrual2AInputOf(c, inst.installmentNo), accruedBefore)
      : null;
    // Accrual-mode classification for the UI chip — ตามวันที่ที่ 2A จะถูกลงจริง:
    //   2B_ONLY       — ไม่มี 2A ที่จะลงพร้อมการรับชำระนี้ (ลงไปแล้ว · สัญญาที่ไม่ตั้งลูกหนี้งวด ·
    //                   QR ที่ยอดยังไม่ครบยอดที่ต้องชำระของงวด)
    //   PAYING_AHEAD  — 2A จะลงวันที่รับเงิน (รับก่อนวันครบกำหนด)
    //   BACKFILL      — 2A จะลงวันครบกำหนด (รับในหรือหลังวันครบกำหนด)
    const pendingFields = pendingAccrualFields(
      pendingAccrual,
      inst.dueDate,
      receiptDate,
      accruedBefore.amount,
    );
    const accrualMode = pendingFields.accrualMode;
    const accrualPostedAt = pendingFields.accrualPostedAt;
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
    // 11-2103 state. ก1: งวดที่ตั้งครบด้วยหลายรายการ (ใบบางส่วน `<id>:receipt-accrual:<k>` + ใบที่ทำให้ครบ)
    // แสดงครบทุกใบที่ยังมีผล — ค้นแบบ "ขึ้นต้นด้วย" ได้ที่นี่เพราะ preview อ่านอย่างเดียวนอกธุรกรรม. `status:'POSTED'` excludes a VOIDED accrual (void keeps
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
            { referenceId: { startsWith: `${inst.id}:receipt-accrual:` } },
          ],
        },
        include: { lines: { where: { deletedAt: null } } },
        orderBy: { createdAt: 'asc' },
      });
      accrualLineRows = accrualEntries
        .filter((e) => (e.metadata as Record<string, unknown> | null)?.reversed !== true)
        .flatMap((e) => e.lines);
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
      ...pendingFields.extra,
    };
  }

  /**
   * สาขา "รับบางส่วน" — mirror PaymentReceiptTemplate ด้วย isFinalReceipt: false ทุกบาท (ไม่หักเงินรับล่วงหน้า ·
   * ไม่ปิดส่วนขาดด้วย 52-1104) + รายการ 2A เท่ายอดที่ใบนี้ล้างลูกหนี้ของงวดเมื่อยังไม่ถึงวันครบกำหนด (ก1).
   * ใช้กับ case 'PARTIAL' และกับยอด QR ที่ยังไม่ครบยอดที่ต้องชำระของงวด — เส้นทางยืนยันของผู้ให้บริการบันทึก
   * recordPayment(…, 'PARTIAL', …) เสมอ (คำตัดสินผู้คุมงาน 2026-09-30 ข้อ 3).
   * Fee-first split (owner 2026-07-02): Cr 42-1103 = late fee owed, Cr 11-2103 = remainder. Uses the SAME
   * pure pipeline the posting runs (computeInstallmentBreakdown → reconstructPriorCleared → splitReceipt →
   * buildReceiptLines) so a follow-up receipt whose fee is already booked previews principal-only.
   */
  private async previewPartialReceipt(args: {
    inst: InstallmentWithContract;
    amountReceived: Prisma.Decimal;
    depositAccountCode: string;
    lateFeeWaivedAmount: Prisma.Decimal;
    netLateFee: Prisma.Decimal;
    installmentTotal: Prisma.Decimal;
    priorPrincipalCleared: Prisma.Decimal;
    priorLateFeeBooked: Prisma.Decimal;
    receiptDate: Date;
    accruedBefore: AccruedSoFar;
  }): Promise<PreviewJournalResult> {
    const {
      inst,
      amountReceived,
      depositAccountCode,
      lateFeeWaivedAmount,
      netLateFee,
      installmentTotal,
      priorPrincipalCleared,
      priorLateFeeBooked,
      receiptDate,
      accruedBefore,
    } = args;
    const c = inst.contract;
    const zero = new Prisma.Decimal(0);
    const rawLines: {
      code: string;
      dr: Prisma.Decimal;
      cr: Prisma.Decimal;
      description: string;
    }[] = [];
    // Mirror recordPayment's guard (orchestrator ~line 325): waiver-on-partial is
    // rejected at save, so the preview must not render a plausible net-fee JE
    // (it would drop the Dr 52-1105 gross-waiver leg and mislead the cashier).
    if (lateFeeWaivedAmount.gt(zero)) {
      throw new BadRequestException(
        'อนุโลมค่าปรับทำได้เฉพาะตอนชำระปิดงวด (ไม่รองรับจ่ายบางส่วน)',
      );
    }
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
      debitAccountCode: depositAccountCode,
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

    // ก1 (29/09/2569): ใบบางส่วนก่อนวันครบกำหนดของงวดที่ยังตั้งไม่ครบ → การบันทึกลง 2A เท่ายอดที่ใบนี้ล้าง
    // ลูกหนี้ของงวด (กติกาตัวเดียวกับ PaymentReceiptTemplate) — แสดงบรรทัดจากตัวสร้างเดียวกัน
    const partialDecision = decideAccrueAtReceipt({
      alreadyAccrued: !!inst.accrualJournalEntryId,
      contractStatusBeforeReceipt: c.status,
      isFinalReceipt: false,
      principalRemainingAfter: split.principalRemainingAfter,
      principalCleared: split.principalCleared,
      dueDateReached: isDueDateReached(inst.dueDate, receiptDate),
    });
    const partialPending =
      partialDecision === 'ACCRUE_RECEIVED'
        ? buildPartialAccrual2ALines(
            accrual2AInputOf(c, inst.installmentNo),
            accruedBefore,
            split.principalCleared,
          )
        : null;
    const partialAccrual = pendingAccrualFields(
      partialPending,
      inst.dueDate,
      receiptDate,
      accruedBefore.amount,
    );
    const partialAccrualRows = (partialPending?.lines ?? []).map((l) => ({
      accountCode: l.accountCode,
      debit: l.dr,
      credit: l.cr,
      description: l.description,
    }));

    const codes = [
      ...new Set([
        ...rawLines.map((l) => l.code),
        ...partialAccrualRows.map((l) => l.accountCode),
      ]),
    ];
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
      accrualPosted: false,
      liveLines: rawLines.map((l) => ({
        accountCode: l.code,
        accountName: nameMap.get(l.code) ?? l.code,
        debit: l.dr.toFixed(2),
        credit: l.cr.toFixed(2),
        description: l.description,
      })),
      accrualLines: partialAccrualRows.map((l) => ({
        accountCode: l.accountCode,
        accountName: nameMap.get(l.accountCode) ?? l.accountCode,
        debit: l.debit.toFixed(2),
        credit: l.credit.toFixed(2),
        description: l.description,
      })),
    });
    return {
      lines: partialBlocks.lines,
      ...(partialBlocks.accrual2A ? { accrual2A: partialBlocks.accrual2A } : {}),
      subtotals: partialBlocks.subtotals,
      totalDebit: totalDebit.toFixed(2),
      totalCredit: totalCredit.toFixed(2),
      isBalanced:
        totalDebit.toFixed(2) === totalCredit.toFixed(2) &&
        (partialBlocks.accrual2A?.subtotal.balanced ?? true),
      ...(partialPending
        ? {
            accrualMode: partialAccrual.accrualMode,
            dueDate: inst.dueDate.toISOString(),
            accrualPostedAt: partialAccrual.accrualPostedAt!.toISOString(),
            ...partialAccrual.extra,
          }
        : {}),
    };
  }
}
