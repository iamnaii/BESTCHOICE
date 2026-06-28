import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountRoleService } from '../../journal/account-role.service';
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
   * Logic mirrors PaymentReceipt2BTemplate but read-only.
   * - If installment NOT yet accrued (accrualJournalEntryId is null):
   *     builds COMBINED 2A+2B+lateFee lines (consolidated posting)
   * - If installment already accrued (cron ran):
   *     builds 2B+lateFee only
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
      where: { contractId_installmentNo: { contractId: input.contractId, installmentNo: input.installmentNo } },
      include: { contract: true },
    });
    if (!inst) throw new NotFoundException('ไม่พบงวดชำระ');

    const c = inst.contract;
    const zero = new Prisma.Decimal(0);

    // Per-installment calculations.
    // Use contract.monthlyPayment as source of truth (set by sales workflow,
    // matches what user sees). Derive breakdown so JE always balances.
    const total = new Prisma.Decimal(c.totalMonths);
    const interest = new Prisma.Decimal(c.interestTotal?.toString() ?? '0');
    const monthly = new Prisma.Decimal((c.monthlyPayment ?? 0).toString());

    // VAT preference: explicit contract.vatAmount → /total ; else 7% on (monthlyPayment*total) excl VAT
    const explicitVat = c.vatAmount != null ? new Prisma.Decimal(c.vatAmount.toString()) : null;
    const vatPerInst = explicitVat != null
      ? explicitVat.div(total).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      : monthly.div('1.07').times('0.07').toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    // installmentExclVat = monthly - vat (so installmentExclVat + vatPerInst === monthly)
    const installmentExclVat = monthly.minus(vatPerInst);
    const interestPerInst = interest.div(total).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const installmentTotal = monthly;

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
    const rawLines: { code: string; dr: Prisma.Decimal; cr: Prisma.Decimal; description: string }[] = [];

    // PARTIAL and RESCHEDULE both emit Cr 11-2103 directly — they assume 2A
    // has already accrued the installment into 11-2103. If 2A is missing
    // (paying ahead, cron lag), the JE would credit a zero-balance account.
    // Block here with a clear Thai message so the wizard can prompt user to
    // wait for the next 2A tick instead of silently producing a malformed JE.
    if (
      !inst.accrualJournalEntryId &&
      (input.case === 'PARTIAL' || input.case === 'RESCHEDULE')
    ) {
      throw new BadRequestException(
        `งวดนี้ยังไม่ได้ทำ accrual (2A) — ไม่สามารถใช้ ${input.case === 'PARTIAL' ? 'จ่ายบางส่วน' : 'เลื่อนงวด'} ได้ก่อน accrual กรุณารอรอบ 00:01 น. หรือใช้รับชำระแบบปกติ`,
      );
    }

    // ── RESCHEDULE case (JP6 template preview) ──────────────────────────────
    if (input.case === 'RESCHEDULE') {
      const days = input.daysToShift ?? 0;
      const monthlyPayment = new Prisma.Decimal(c.monthlyPayment.toString());
      // Reschedule fee = installmentTotal / 30 × daysToShift, rounded UP to a whole
      // baht (owner policy 2026-06 — ปัดเศษขึ้นเต็มบาท). Matches RescheduleService.execute.
      const rescheduleFee = days > 0
        ? monthlyPayment.div(30).times(days).toDecimalPlaces(0, Prisma.Decimal.ROUND_UP)
        : zero;

      const isSplit = input.splitMode === 'SPLIT';
      const amountReceived = new Prisma.Decimal(input.amountReceived.toString());

      if (isSplit) {
        // 6a — fee advance only (step 1):
        //   Dr depositAccountCode  feeAmount
        //     Cr 21-1103           feeAmount (เงินรับล่วงหน้างวดสุดท้าย)
        const feeAmount = rescheduleFee.gt(zero) ? rescheduleFee : amountReceived;
        rawLines.push({ code: input.depositAccountCode, dr: feeAmount, cr: zero, description: 'รับค่าปรับดิวล่วงหน้า (6a)' });
        rawLines.push({ code: '21-1103', dr: zero, cr: feeAmount, description: 'เงินรับล่วงหน้างวดสุดท้าย' });
      } else {
        // 6b — bundled (installment + fee in one transaction):
        //   Dr depositAccountCode  installmentAmount + feeAmount
        //     Cr 11-2103           installmentAmount
        //     Cr 21-1103           feeAmount
        const bundledTotal = installmentTotal.plus(rescheduleFee);
        rawLines.push({ code: input.depositAccountCode, dr: bundledTotal, cr: zero, description: 'รับชำระงวด + ค่าปรับดิว (6b)' });
        rawLines.push({ code: '11-2103', dr: zero, cr: installmentTotal, description: 'ล้างลูกหนี้ค้างชำระงวด' });
        rawLines.push({ code: '21-1103', dr: zero, cr: rescheduleFee, description: 'เงินรับล่วงหน้างวดสุดท้าย' });
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

    // ── PARTIAL case: minimal partial-clear preview ─────────────────────────
    if (input.case === 'PARTIAL') {
      const amountReceived = new Prisma.Decimal(input.amountReceived.toString());
      rawLines.push({ code: input.depositAccountCode, dr: amountReceived, cr: zero, description: 'รับชำระบางส่วน' });
      rawLines.push({ code: '11-2103', dr: zero, cr: amountReceived, description: 'ล้างลูกหนี้ค้างชำระ (บางส่วน)' });

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
      accrualMode = inst.dueDate.getTime() > todayMidnight.getTime()
        ? 'CONSOLIDATED_PAYING_AHEAD'
        : 'CONSOLIDATED_BACKFILL';
    }

    // Dr: cash/bank received. The wizard's amountReceived IS the full net cash — it
    // already nets out the late-fee waiver + the advance deduction — mirroring what
    // the save posts (orchestrator delta = amount). Do NOT add late fee on top.
    const totalReceived = amountReceived;

    // ── Advance balance split (mirror recordPayment §Task 4) ────────────────
    // Owed = installment + NET late fee (gross − waived); the waived portion books to
    // Dr 52-1105, not collected in cash.
    const advanceBalance = new Prisma.Decimal((c.advanceBalance ?? 0).toString());
    const remaining = installmentTotal.plus(netLateFee); // net owed (no prevPaid in preview)
    const overage = amountReceived.minus(remaining);
    let previewAdvCredit = zero;
    let previewAdvConsume = zero;

    if (overage.gt(new Prisma.Decimal('1.00')) && input.case === 'OVERPAY_ADVANCE') {
      previewAdvCredit = overage;
    } else if (
      (input.consumeAdvance ?? true) &&
      amountReceived.lt(remaining) &&
      advanceBalance.gt(zero) &&
      (input.case === undefined || input.case === 'NORMAL')
    ) {
      // Mirror orchestrator: only auto-consume when the credit checkbox is on.
      const gap = remaining.minus(amountReceived);
      previewAdvConsume = Prisma.Decimal.min(advanceBalance, gap);
    }

    // 1. Cash in (skip when 0 — full advance cover edge)
    if (totalReceived.gt(zero)) {
      rawLines.push({ code: input.depositAccountCode, dr: totalReceived, cr: zero, description: 'รับชำระ' });
    }

    // 2. Consume existing advance
    if (previewAdvConsume.gt(zero)) {
      rawLines.push({ code: '21-1103', dr: previewAdvConsume, cr: zero, description: 'หักเงินรับล่วงหน้า' });
    }

    // 2b. Late-fee waiver discount (Dr 52-1105) — Cr 42-1103 below stays GROSS.
    if (lateFeeWaivedAmount.gt(zero)) {
      rawLines.push({ code: '52-1105', dr: lateFeeWaivedAmount, cr: zero, description: 'ส่วนลดให้ลูกค้า — อนุโลมค่าปรับ' });
    }

    if (isConsolidated) {
      // CONSOLIDATED 2A+2B: Dr 21-2102 + 11-2106 to clear accrual side
      rawLines.push({ code: '21-2102', dr: vatPerInst, cr: zero, description: 'ล้าง VAT รอเรียกเก็บ' });
      rawLines.push({ code: '11-2106', dr: interestPerInst, cr: zero, description: 'ล้าง Unearned รายได้รอตัดบัญชี' });
      // Cr: clear gross receivable, VAT asset, and recognize income
      rawLines.push({ code: '11-2101', dr: zero, cr: installmentExclVat, description: 'ลูกหนี้ Gross (ลด)' });
      rawLines.push({ code: '11-2105', dr: zero, cr: vatPerInst, description: 'VAT รอเรียกเก็บ (ล้าง)' });
      rawLines.push({ code: '21-2101', dr: zero, cr: vatPerInst, description: 'ภาษีขาย ภ.พ.30' });
      rawLines.push({ code: '41-1101', dr: zero, cr: interestPerInst, description: 'รายได้ดอกเบี้ย (รับรู้)' });
    } else {
      // 2B ONLY: installment already accrued, just clear the accrued receivable
      rawLines.push({ code: '11-2103', dr: zero, cr: installmentTotal, description: 'ล้างลูกหนี้ค้างชำระ' });
    }

    // Late fee: Cr 42-1103 if > 0
    if (lateFeeAmount.gt(zero)) {
      rawLines.push({ code: '42-1103', dr: zero, cr: lateFeeAmount, description: 'ค่าปรับชำระล่าช้า' });
    }

    // 5. Park new advance (overpay → 21-1103)
    if (previewAdvCredit.gt(zero)) {
      rawLines.push({ code: '21-1103', dr: zero, cr: previewAdvCredit, description: 'เงินรับล่วงหน้า' });
    }

    // 6. Rounding adjustment (≤1฿ tolerance) — must include for balanced preview
    // This mirrors PaymentReceipt2BTemplate's rounding logic.
    // Skipped for OVERPAY_ADVANCE / advance consume because those clear the diff via 21-1103.
    if (previewAdvCredit.eq(zero) && previewAdvConsume.eq(zero)) {
      const roundingDiff = amountReceived.minus(installmentTotal.plus(netLateFee));
      const tolerance = new Prisma.Decimal('1.00');
      if (roundingDiff.gt(zero) && roundingDiff.lte(tolerance)) {
        // D1.1.6.2 — resolve via AccountRoleService when available, otherwise
        // fall back to spec-default 53-1503 (matches the seed row).
        const adjOverpayCode =
          this.accountRoleService?.tryCode('adj_overpay') ?? '53-1503';
        rawLines.push({ code: adjOverpayCode, dr: zero, cr: roundingDiff, description: 'กำไรปัดเศษ (Policy C)' });
      } else if (roundingDiff.lt(zero) && roundingDiff.abs().lte(tolerance)) {
        // D1.1.6.1 — resolve via AccountRoleService when available, otherwise
        // fall back to spec-default 52-1104 (matches the seed row).
        const adjUnderpayCode =
          this.accountRoleService?.tryCode('adj_underpay') ?? '52-1104';
        rawLines.push({ code: adjUnderpayCode, dr: roundingDiff.abs(), cr: zero, description: 'ส่วนลดเศษสตางค์ (Policy C)' });
      }
    }

    // 2B_ONLY: fetch the already-POSTED 2A accrual context (read-only). Includes
    // BOTH the accrual JE (by entryNumber == stamped accrualJournalEntryId) AND any
    // advance-consume-on-accrual JE (Dr 21-1103 / Cr 11-2103, referenceId-tagged by
    // InstallmentAccrual2ATemplate) so the 2A block truthfully reflects the real
    // 11-2103 state. `status:'POSTED'` excludes a VOIDED accrual (void keeps
    // deletedAt null in this codebase — see shop-collect void regression test).
    // The mockup case has no consume JE → 2A = the clean 2,115.00 accrual.
    // NOTE (Phase 2): the live 2B leg still credits the full installmentTotal to
    // 11-2103; reconciling that against prior clears (reconstructPrior) is §4.1.
    let accrualLineRows: { accountCode: string; debit: Prisma.Decimal; credit: Prisma.Decimal; description: string | null }[] = [];
    if (!isConsolidated && inst.accrualJournalEntryId) {
      const accrualEntries = await this.prisma.journalEntry.findMany({
        where: {
          status: 'POSTED',
          deletedAt: null,
          OR: [
            { entryNumber: inst.accrualJournalEntryId },
            { referenceId: `${inst.id}:advance-consume-on-accrual` },
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
