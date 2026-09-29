import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildAccrual2ALines,
  resolveAccrualPeriodCheckDate,
  resolveAccrualPostingDate,
} from '../build-accrual-2a-lines';
import { feeNettedOutstanding } from '../compute-cn-breakdown';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import {
  ADVANCE_CONSUME_ON_ACCRUAL_FLOW,
  RESCHEDULE_PARK_CONSUME_FLOW,
} from '../reconstruct-prior';
// EIR utility removed — CPA Policy A revert (#783) reverted to straight-line allocation.

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
 * Interest recognition: EIR (Effective Interest Method) per TFRS 15 §60-65.
 *   - Period 1: highest interest (= openingPrincipal × monthlyEIR)
 *   - Period N: lowest interest (snap to clear residual)
 *   - Total interest = interestTotal (matches contract)
 *
 * Updated from straight-line allocation (Wave 4 / Option B / Phase 2 EIR migration).
 *
 * Rounding modes:
 *   installmentExclVat = grossExclVat / totalMonths → ROUND_DOWN  (17000/12 = 1416.66)
 *   vatPerInst         = vatTotal / totalMonths     → ROUND_HALF_UP (1190/12 = 99.17)
 *   interestPerInst    = interest / totalMonths     → ROUND_HALF_UP straight-line (CPA Policy A · #783)
 *
 * Recognition policy:
 *   - TFRS 15 §35(b): performance obligation satisfied "over time" — financing
 *     service is consumed by the customer through each due date, so revenue is
 *     recognised per period (this template, fired daily by accrual cron).
 *   - VAT recognition: deferred VAT (21-2102 booked at contract activation) is
 *     reclassified to settled VAT (21-2101) per period — matches TFRS 15
 *     pattern of recognising tax liability when service is performed.
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
/** `metadata.trigger` ของรายการ 2A ที่ลง ณ วันรับเงิน (คำตัดสินฝ่ายบัญชี D2, 2026-09-28). */
export const ACCRUAL_TRIGGER_RECEIPT = 'receipt';

type AccrualInstallment = Prisma.InstallmentScheduleGetPayload<Record<string, never>>;
type AccrualContract = Prisma.ContractGetPayload<Record<string, never>>;

export interface AccrueAtReceiptResult {
  entryNo: string;
  /** วันที่ลงรายการ 2A = min(วันครบกำหนด, วันที่รับเงิน). */
  postedAt: Date;
}

@Injectable()
export class InstallmentAccrual2ATemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    installmentScheduleId: string,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string } | null> {
    // Fast idempotency check outside the transaction (avoids opening a tx for
    // already-accrued installments — the common case on repeated cron ticks).
    // อ่านผ่านธุรกรรมของผู้เรียกเมื่อมี — client หลักมองไม่เห็นแถวตารางงวดที่เพิ่งสร้างและยังไม่ commit
    const instCheck = await (outerTx ?? this.prisma).installmentSchedule.findUniqueOrThrow({
      where: { id: installmentScheduleId },
      select: { accrualJournalEntryId: true },
    });
    if (instCheck.accrualJournalEntryId) return null;

    if (outerTx) {
      return this.run(installmentScheduleId, outerTx);
    }
    // No outer tx — self-wrap so the JE post + accrualJournalEntryId stamp +
    // advance-consume JE + contract/payment updates are one atomic unit.
    // A crash between any of these steps can no longer produce a duplicate
    // accrual JE on the next cron tick (the idempotency stamp is committed
    // atomically with the JE).
    //
    // Serializable isolation: the advance-consume leg reads contract.advanceBalance
    // then decrements it. The payment paths (PaySolutions webhook, recordPayment) also
    // decrement advanceBalance under Serializable — without matching isolation here a
    // concurrent accrual + payment could both read the same balance and double-consume.
    // On a serialization conflict the cron's per-installment try/catch retries next tick
    // (idempotent — accrualJournalEntryId is not stamped on a rolled-back tx).
    return this.prisma.$transaction((tx) => this.run(installmentScheduleId, tx), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  /**
   * ตั้งลูกหนี้งวด ณ วันรับเงิน (คำตัดสินฝ่ายบัญชี D2, 2026-09-28) — เรียกจาก
   * PaymentReceiptTemplate ภายในธุรกรรมของการรับชำระเท่านั้น.
   *
   * "แกนอย่างเดียว": ลงรายการ 2A + ประทับ accrualJournalEntryId เท่านั้น — ไม่หักเงินรับล่วงหน้า
   * (ทั้งถังรวมและถังพักงวดสุดท้าย) และไม่แตะแถว Payment เพราะเส้นทางรับชำระเป็นผู้จัดการสองอย่างนั้น.
   * ตรวจซ้ำ (idempotency) ด้วย `tx` ที่ส่งเข้ามา จึงเห็นตารางงวดที่เพิ่งสร้างในธุรกรรมเดียวกัน
   * (ensureInstallmentSchedules).
   *
   * ไม่ตรวจสถานะสัญญา: เส้นทางรับชำระเปลี่ยนสถานะสัญญาเป็น COMPLETED / EARLY_PAYOFF ก่อนเรียกมาถึงที่นี่
   * ผู้เรียก (PaymentReceiptTemplate) เป็นผู้ตัดสินจากสถานะก่อนรับเงิน.
   * ไม่จับ error ของฐานข้อมูล (P2002 / P2034): ปล่อยให้ธุรกรรมของผู้เรียกล้มตามเดิม.
   *
   * คืน null เมื่องวดถูกตั้งลูกหนี้ไปแล้ว.
   */
  async accrueAtReceipt(
    installmentScheduleId: string,
    receiptDate: Date,
    tx: Prisma.TransactionClient,
  ): Promise<AccrueAtReceiptResult | null> {
    const inst = await tx.installmentSchedule.findUniqueOrThrow({
      where: { id: installmentScheduleId },
    });
    if (inst.accrualJournalEntryId) return null;

    const c = await tx.contract.findUniqueOrThrow({ where: { id: inst.contractId } });
    const postedAt = resolveAccrualPostingDate(inst.dueDate, receiptDate);
    await this.assertAccrualPeriodOpen(
      tx,
      inst.installmentNo,
      resolveAccrualPeriodCheckDate(inst.dueDate, receiptDate),
    );

    const core = await this.postCore(inst, c, tx, {
      postedAt,
      extraMetadata: {
        trigger: ACCRUAL_TRIGGER_RECEIPT,
        receiptDate: receiptDate.toISOString(),
      },
    });
    return { entryNo: core.entryNo, postedAt };
  }

  /** บรรทัดรายการ 2A จากตัวสร้างกลาง (ใช้ร่วมกับ preview) — ห้ามคำนวณยอดเองในไฟล์นี้. */
  private buildLines(inst: AccrualInstallment, c: AccrualContract) {
    return buildAccrual2ALines({
      financedAmount: c.financedAmount.toString(),
      storeCommission: c.storeCommission != null ? c.storeCommission.toString() : null,
      interestTotal: c.interestTotal.toString(),
      vatAmount: c.vatAmount != null ? c.vatAmount.toString() : null,
      totalMonths: c.totalMonths,
      installmentNo: inst.installmentNo,
    });
  }

  /** ลงรายการ 2A + ประทับ accrualJournalEntryId (ธุรกรรมเดียวกัน). */
  private async postCore(
    inst: AccrualInstallment,
    c: AccrualContract,
    tx: Prisma.TransactionClient,
    opts: { postedAt: Date; extraMetadata?: Record<string, string> },
  ): Promise<{ entryNo: string; installmentTotal: Decimal }> {
    const built = this.buildLines(inst, c);

    const result = await this.journal.createAndPost(
      {
        description: `Accrual งวด #${inst.installmentNo} — สัญญา ${c.contractNumber}`,
        reference: inst.id,
        metadata: {
          tag: '2A',
          contractId: c.id,
          installmentScheduleId: inst.id,
          ...(opts.extraMetadata ?? {}),
        },
        postedAt: opts.postedAt,
        lines: built.lines,
      },
      tx,
    );

    // Mark installment as accrued (idempotency)
    await tx.installmentSchedule.update({
      where: { id: inst.id },
      data: { accrualJournalEntryId: result.entryNumber },
    });

    return { entryNo: result.entryNumber, installmentTotal: built.installmentTotal };
  }

  /**
   * งวดบัญชี FINANCE ของรายการ 2A ต้องยังเปิด — ถ้าปิดแล้ว ปฏิเสธการรับชำระทั้งรายการ (ธุรกรรมของ
   * ผู้เรียก roll back). `periodCheckDate` คือ Date ที่ใช้ตัดสินงวด (resolveAccrualPeriodCheckDate).
   *
   * ข้อความบอก**เฉพาะเดือนที่ปิด** อ่านจาก `periodCheckDate` ด้วย getter ชุดเดียวกับ validatePeriodOpen
   * (เวลาของเครื่อง) จึงเป็นเดือนเดียวกับที่ถูกตรวจเสมอ. ไม่ใส่วันที่ลงรายการ: วันที่นั้นแสดงตามเวลาไทย
   * แต่เดือนของงวดบัญชีตัดสินตามเวลาของเครื่อง — งวดที่ครบกำหนดวันที่ 1 จะอ่านขัดกันเองถ้าใส่ทั้งสองอย่าง.
   * ให้ติดต่อฝ่ายบัญชี — ไม่ชี้เมนู (การเปิดงวดเป็นสิทธิ์ของเจ้าของกิจการ) และไม่รับปากว่าเปิดได้เสมอ
   * (งวดที่ส่งเข้าโปรแกรมบัญชีภายนอกแล้วเปิดไม่ได้).
   */
  private async assertAccrualPeriodOpen(
    tx: Prisma.TransactionClient,
    installmentNo: number,
    periodCheckDate: Date,
  ): Promise<void> {
    const finance = await tx.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    try {
      await validatePeriodOpen(tx, periodCheckDate, finance?.id);
    } catch (e) {
      if (e instanceof BadRequestException) {
        const closedMonth =
          `${String(periodCheckDate.getMonth() + 1).padStart(2, '0')}/` +
          `${periodCheckDate.getFullYear() + 543}`;
        throw new BadRequestException(
          `ไม่สามารถรับชำระงวด #${installmentNo} ได้ — ระบบต้องตั้งลูกหนี้งวดนี้ในงวดบัญชีเดือน ${closedMonth} ซึ่งปิดแล้ว ` +
            'กรุณาติดต่อฝ่ายบัญชีเพื่อขอเปิดงวดบัญชีเดือนดังกล่าว เมื่อเปิดงวดแล้วจึงบันทึกรับชำระอีกครั้ง',
        );
      }
      throw e;
    }
  }

  private async run(
    installmentScheduleId: string,
    tx: Prisma.TransactionClient,
  ): Promise<{ entryNo: string } | null> {
    const inst = await tx.installmentSchedule.findUniqueOrThrow({
      where: { id: installmentScheduleId },
    });

    // Idempotency guard (re-check inside tx in case two concurrent cron ticks
    // both passed the outer fast-check before either committed).
    if (inst.accrualJournalEntryId) return null;

    const c = await tx.contract.findUniqueOrThrow({ where: { id: inst.contractId } });

    // รอบกลางคืน: ลงวันครบกำหนด (พฤติกรรมเดิม) — บรรทัดรายการมาจากตัวสร้างกลางตัวเดียวกับ
    // 2A ณ วันรับเงินและ preview
    const core = await this.postCore(inst, c, tx, { postedAt: inst.dueDate });
    const installmentTotal = core.installmentTotal;
    const zero = new Decimal(0);

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
    // Atomicity: posted in the same tx as the accrual JE + schedule update,
    // so a JE-post failure rolls everything back — no partially-consumed
    // advance with the receivable still showing.
    const advanceBalance = new Decimal(c.advanceBalance.toString());
    let genericConsumed = zero;
    if (advanceBalance.gt(0)) {
      const consume = Decimal.min(advanceBalance, installmentTotal);
      genericConsumed = consume;

      await this.journal.createAndPost(
        {
          description: `หักเงินรับล่วงหน้าเข้างวด #${inst.installmentNo} — สัญญา ${c.contractNumber}`,
          // Flow string + reference suffix come from the SAME constant
          // reconstructPriorCleared's always-include allow-list is built from, so
          // the reader and the writer can never drift (see reconstruct-prior.ts).
          reference: `${inst.id}:${ADVANCE_CONSUME_ON_ACCRUAL_FLOW}`,
          metadata: {
            tag: '2B',
            flow: ADVANCE_CONSUME_ON_ACCRUAL_FLOW,
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
      await tx.contract.update({
        where: { id: c.id },
        data: { advanceBalance: { decrement: consume } },
      });

      // Reflect the consume on the existing Payment row (if one was
      // pre-created when the advance was first received). Fully covered
      // installments flip to PAID; partial covers stay PARTIALLY_PAID.
      const payment = await tx.payment.findFirst({
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
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            amountPaid: newAmountPaid,
            status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
            paidDate: isPaidInFull ? new Date() : null,
            paidAt: isPaidInFull ? new Date() : null,
          },
        });
      } else {
        // No Payment row at accrual time. The advance-consume JE still posts
        // correctly (Dr 21-1103 / Cr 11-2103) — but the Payment row's amountPaid
        // stays at its prior value (0 when the row is created later). That timing
        // window makes FINAL-REVIEW BLOCKER 1 reachable: a subsequent receipt fired
        // against that 0-amountPaid Payment would re-clear an installment the
        // advance already cleared. Alert ops to backfill the Payment row so it
        // reflects the consume. Do NOT throw — that would break the accrual cron.
        Sentry.captureMessage('Advance consumed on accrual with no Payment row to update', {
          level: 'error',
          tags: {
            module: 'journal',
            action: 'advance-consume-no-payment-row',
          },
          extra: {
            contractId: c.id,
            contractNumber: c.contractNumber,
            installmentScheduleId: inst.id,
            installmentNo: inst.installmentNo,
            consume: consume.toFixed(2),
          },
        });
      }
    }

    // Park-at-last-installment (owner directive 2026-08-16) — Contract.
    // rescheduleAdvanceBalance is a SEPARATE bucket from the generic advance
    // above (reschedule fees, 6a/6b). It is relieved ONLY on the contract's
    // LAST installment, never FIFO'd into whichever installment accrues next
    // — every OTHER installment must leave this bucket untouched. Runs AFTER
    // the generic-advance block so its cap (installmentTotal minus whatever
    // the generic advance already cleared) reflects any generic consume that
    // happened above in this same tx.
    const parkBalance = new Decimal((c.rescheduleAdvanceBalance ?? 0).toString());
    const remainingAfterGeneric = installmentTotal.minus(genericConsumed);

    // Both "nothing parked" and "generic advance already covered the whole
    // installment" are decided BEFORE any Payment I/O: in either case
    // `parkConsume` would be 0 no matter what the row says, so reading it would
    // be a wasted query on every last-installment accrual of every contract that
    // has no park bucket (the overwhelming majority). Keeping the short-circuit
    // here also preserves the pre-park invariant that this branch performs zero
    // Payment reads when there is no park balance to relieve.
    if (inst.installmentNo === c.totalMonths && parkBalance.gt(0) && remainingAfterGeneric.gt(0)) {
      // Payment row read UP FRONT (was: after the JE post) — it is now an INPUT to
      // the cap, not just something to stamp afterwards. Reading it here is exactly
      // as fresh: the generic block above already committed its own
      // `payment.update` earlier in this same tx, and posting the park JE does not
      // touch Payment rows.
      const paymentForPark = await tx.payment.findFirst({
        where: {
          contractId: c.id,
          installmentNo: inst.installmentNo,
          deletedAt: null,
        },
        select: {
          id: true,
          amountDue: true,
          amountPaid: true,
          lateFee: true,
          lateFeeWaived: true,
        },
      });

      // I-3 (final review 2026-08-16) — cap by what is ACTUALLY still owed on the
      // row, not just by `installmentTotal − genericConsumed`.
      //
      // The last installment can legitimately be settled (or part-settled) BEFORE
      // its own accrual runs — that is จุดหัก 2 of the park spec (wizard/orchestrator
      // pays the last installment early and relieves the park bucket there). Without
      // this cap the accrual relieves the park a SECOND time: `Payment.amountPaid`
      // climbs above `amountDue` and 11-2103 goes NEGATIVE for the row.
      //
      // The remaining-balance formula is the house FEE-FIRST convention (PR #1313).
      // It is IMPORTED from `feeNettedOutstanding` in
      // `apps/api/src/modules/journal/compute-cn-breakdown.ts` — the single source of
      // truth shared by ECL (DUE) and CN (ACCRUED) — rather than re-derived here, per
      // that plan's Global Constraint that this formula must never exist in two
      // places. (Repair round 2, 2026-08-17: was a verbatim local copy.)
      // No Payment row at all → installment never touched → fully outstanding
      // (same convention as computeInstallmentOutstanding's ACCRUED branch).
      // NOTE: the GENERIC block above deliberately keeps its pre-existing
      // (uncapped) behaviour — out of scope here.
      const rowOutstanding = paymentForPark
        ? feeNettedOutstanding(paymentForPark, installmentTotal)
        : installmentTotal;
      const parkCap = Decimal.min(remainingAfterGeneric, rowOutstanding);

      // `parkBalance > 0` and `remainingAfterGeneric > 0` are already guaranteed by
      // the outer guard; only the row-outstanding half of the cap can still zero it
      // out (last installment already settled early — จุดหัก 2).
      if (parkCap.gt(0)) {
        const parkConsume = Decimal.min(parkBalance, parkCap);

        await this.journal.createAndPost(
          {
            description: `หักเงินพักปรับดิวเข้างวดสุดท้าย #${inst.installmentNo} — สัญญา ${c.contractNumber}`,
            // Same constant reconstructPriorCleared's always-include allow-list is
            // built from — see reconstruct-prior.ts (C-1).
            reference: `${inst.id}:${RESCHEDULE_PARK_CONSUME_FLOW}`,
            metadata: {
              tag: '2B',
              flow: RESCHEDULE_PARK_CONSUME_FLOW,
              contractId: c.id,
              installmentScheduleId: inst.id,
              installmentNo: inst.installmentNo,
              consumeAmount: parkConsume.toFixed(2),
            },
            postedAt: inst.dueDate,
            lines: [
              {
                accountCode: '21-1103',
                dr: parkConsume,
                cr: zero,
                description: 'หักเงินพักปรับดิวเข้างวดสุดท้าย',
              },
              {
                accountCode: '11-2103',
                dr: zero,
                cr: parkConsume,
                description: 'ล้างลูกหนี้ค้างชำระ (จากเงินพักปรับดิว)',
              },
            ],
          },
          tx,
        );

        // Decrement contract's parked reschedule-fee balance by the consumed amount.
        await tx.contract.update({
          where: { id: c.id },
          data: { rescheduleAdvanceBalance: { decrement: parkConsume } },
        });

        // Reflect the consume on the Payment row — same stamping shape as the
        // generic consume above. Uses the row read UP FRONT for the cap (the
        // generic block's own update already landed before that read, and posting
        // the park JE does not touch Payment rows).
        if (paymentForPark) {
          const newAmountPaid = new Decimal(paymentForPark.amountPaid.toString()).plus(parkConsume);
          const due = new Decimal((paymentForPark.amountDue ?? installmentTotal).toString());
          const isPaidInFull = newAmountPaid.gte(due);
          await tx.payment.update({
            where: { id: paymentForPark.id },
            data: {
              amountPaid: newAmountPaid,
              status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
              paidDate: isPaidInFull ? new Date() : null,
              paidAt: isPaidInFull ? new Date() : null,
            },
          });
        } else {
          // Mirrors the generic-advance no-Payment-row alarm above — alert ops
          // instead of silently dropping the stamp (would let a later receipt
          // re-clear an installment the park consume already cleared).
          Sentry.captureMessage(
            'Reschedule park balance consumed on accrual with no Payment row to update',
            {
              level: 'error',
              tags: {
                module: 'journal',
                action: 'reschedule-park-consume-no-payment-row',
              },
              extra: {
                contractId: c.id,
                contractNumber: c.contractNumber,
                installmentScheduleId: inst.id,
                installmentNo: inst.installmentNo,
                consume: parkConsume.toFixed(2),
              },
            },
          );
        }
      }
    }

    return { entryNo: core.entryNo };
  }
}
