import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountRoleService } from '../../journal/account-role.service';
import { computeInstallmentBreakdown } from '../../journal/compute-installment-breakdown';
import { splitReceipt } from '../../journal/split-receipt';
import { buildReceiptLines } from '../../journal/build-receipt-lines';
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
   * the live lines ALWAYS clear 11-2103 (the save never posts consolidated
   * 2A+2B legs — the nightly accrual cron backfills 2A regardless of PAID).
   * `accrualMode` tells the UI whether 2A already ran (2B_ONLY) or the cron
   * will backfill (CONSOLIDATED_PAYING_AHEAD / CONSOLIDATED_BACKFILL).
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
  }): Promise<{
    lines: PreviewTaggedLine[];
    accrual2A?: { lines: PreviewTaggedLine[]; subtotal: BlockSubtotal };
    subtotals: { '2A'?: BlockSubtotal; '2B': BlockSubtotal };
    totalDebit: string;
    totalCredit: string;
    isBalanced: boolean;
    rescheduleFeeDisplay?: string;
    /**
     * 2B_ONLY: 2A daily accrual cron has already posted for this installment.
     *   JE clears 11-2103 only.
     * CONSOLIDATED_PAYING_AHEAD: dueDate is in the future — customer is paying
     *   before due. 2A has not yet fired; preview folds 2A+2B into one JE so
     *   the books balance without recognizing revenue early in two passes.
     * CONSOLIDATED_BACKFILL: dueDate is past or today but 2A is missing —
     *   anomaly the daily cron will catch up on the next 00:01 BKK run.
     */
    accrualMode?: '2B_ONLY' | 'CONSOLIDATED_PAYING_AHEAD' | 'CONSOLIDATED_BACKFILL';
    dueDate?: string;
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

    // PARTIAL emits Cr 11-2103 directly — it assumes 2A has already accrued the
    // installment into 11-2103. If 2A is missing (paying ahead, cron lag), the JE
    // would credit a zero-balance account. Block here with a clear Thai message so
    // the wizard can prompt the user to wait for the next 2A tick instead of
    // silently producing a malformed JE.
    // (RESCHEDULE no longer needs this guard — its collect-first JE touches only
    //  21-1103 / 42-1103, never 11-2103; the old bundled-6b preview that credited
    //  11-2103 was replaced by the collect semantics on 2026-07-02.)
    if (!inst.accrualJournalEntryId && input.case === 'PARTIAL') {
      throw new BadRequestException(
        'งวดนี้ยังไม่ได้ทำ accrual (2A) — ไม่สามารถใช้จ่ายบางส่วนได้ก่อน accrual กรุณารอรอบ 00:01 น. หรือใช้รับชำระแบบปกติ',
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
    const isConsolidated = !inst.accrualJournalEntryId; // 2A not yet run

    // Accrual-mode classification for UI explanation chip:
    //   PAYING_AHEAD   — dueDate is in the future, customer paying early
    //   BACKFILL       — dueDate has passed but 2A still missing (cron lag)
    //   2B_ONLY        — 2A already posted, JE only clears 11-2103
    let accrualMode: '2B_ONLY' | 'CONSOLIDATED_PAYING_AHEAD' | 'CONSOLIDATED_BACKFILL';
    if (!isConsolidated) {
      accrualMode = '2B_ONLY';
    } else {
      const todayMidnight = new Date();
      todayMidnight.setHours(0, 0, 0, 0);
      accrualMode =
        inst.dueDate.getTime() > todayMidnight.getTime()
          ? 'CONSOLIDATED_PAYING_AHEAD'
          : 'CONSOLIDATED_BACKFILL';
    }

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

    const isBalanced = totalDebit.toFixed(2) === totalCredit.toFixed(2);

    const blocks = buildPreviewBlocks({
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

    return {
      lines: blocks.lines,
      accrual2A: blocks.accrual2A,
      subtotals: blocks.subtotals,
      totalDebit: totalDebit.toFixed(2),
      totalCredit: totalCredit.toFixed(2),
      isBalanced,
      accrualMode,
      dueDate: inst.dueDate.toISOString(),
    };
  }
}
