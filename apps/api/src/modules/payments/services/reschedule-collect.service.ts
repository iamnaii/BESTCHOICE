import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { RescheduleService } from '../../installments/reschedule.service';
import { ReceiptsService } from '../../receipts/receipts.service';
import { loadLateFeeConfig } from '../../../utils/late-fee.util';
import {
  computeRescheduleQuote,
  RescheduleQuote,
  RescheduleSplitMode,
} from '../../../utils/reschedule-quote.util';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { d } from '../../../utils/decimal.util';
import {
  resolveUserDefaultCashAccount,
  resolveFinanceCompanyId,
} from './payment-helpers';

export interface RescheduleCollectInput {
  contractId: string;
  installmentNo: number;
  daysToShift: number;
  splitMode: RescheduleSplitMode;
  /**
   * Cash the cashier says they collected. Cross-checked against the server-side
   * quote (±0.01) — a mismatch means the fee/late fee changed since the UI quoted
   * (e.g. crossed midnight) and the cashier must re-open the dialog. Ignored when
   * the quote's collectAmount is 0 (6b, no late fee → nothing to collect).
   */
  amount: number;
  /** CASH | BANK_TRANSFER | ONLINE_GATEWAY (QR webhook path). */
  paymentMethod: string;
  recordedById: string;
  transactionRef?: string;
  evidenceUrl?: string;
  depositAccountCode?: string;
  /**
   * QR-webhook path only: the quote frozen at QR creation (link.metadata). The
   * customer already paid link.amount — we book THESE amounts instead of
   * recomputing (a fee that grew between QR creation and payment is forgiven;
   * the 24h link expiry bounds the drift to one day of per-day late fee).
   */
  fixedQuote?: { rescheduleFee: string; lateFee: string; collectAmount: string };
}

export interface RescheduleCollectResult {
  success: true;
  case: 'RESCHEDULE';
  variant: '6a' | '6b';
  rescheduleFee: string;
  lateFeeCollected: string;
  collectAmount: string;
  journalEntryNo: string | null;
  shiftedInstallmentCount: number;
  shiftedInstallmentIds: string[];
}

/**
 * ปรับดิว collect-first (owner directive 2026-07-02) — "เงินไม่เข้า ดิวไม่เลื่อน".
 *
 * Replaces the old fire-and-forget RESCHEDULE branch (which shifted due dates
 * with ZERO cash collected, letting the late fee evaporate when the cron
 * recomputed against the new due date). Now ONE Serializable transaction:
 *
 *   1. Recompute the quote server-side (fee = monthly/30×days ROUND_UP;
 *      lateFee = mode-aware resolveLivePaymentLateFee vs the CURRENT due date).
 *   2. Validate the collected amount matches the quote (cashier paths).
 *   3. Post the collect JE (skipped when nothing to collect):
 *        Dr  deposit (cash/bank)        [collectAmount]
 *           Cr 21-1103 เงินรับล่วงหน้า     [rescheduleFee]   (6a only)
 *           Cr 42-1103 ค่าปรับชำระล่าช้า    [lateFee]         (if > 0)
 *      metadata.tag = 'reschedule-collect' — intentionally NOT 'receipt', so
 *      reconstructPriorCleared ignores it (the fee belongs to the OLD overdue
 *      period which this collect settles; a NEW overdue period vs the new due
 *      date accrues its own fee from zero).
 *   4. Reset Payment.lateFee → 0 (collected) + append an audit note.
 *   5. RescheduleService.execute(..., tx) — shift due dates + reduce last
 *      installment + RESCHEDULE AuditLog, all on the same tx.
 *   6. AuditLog RESCHEDULE_COLLECT (money detail, hash-chained via audit table).
 *
 * After commit (I3 ordering — never roll back committed money): e-Receipt
 * type 'RESCHEDULE_FEE' via ReceiptsService, failures logged not thrown.
 */
@Injectable()
export class RescheduleCollectService {
  private readonly logger = new Logger(RescheduleCollectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journalAutoService: JournalAutoService,
    private readonly rescheduleService: RescheduleService,
    private readonly receiptsService: ReceiptsService,
  ) {}

  /** Server-authoritative quote for the overlay (display + amount prefill). */
  async quote(input: {
    contractId: string;
    installmentNo: number;
    daysToShift: number;
    splitMode: RescheduleSplitMode;
  }): Promise<{
    rescheduleFee: string;
    lateFee: string;
    collectAmount: string;
    variant: '6a' | '6b';
    newDueDate: string;
    currentDueDate: string;
  }> {
    const { contract, payment } = await this.loadRow(this.prisma, input.contractId, input.installmentNo);
    const q = await this.buildQuote(this.prisma, contract, payment, input.daysToShift, input.splitMode);
    const newDue = new Date(payment.dueDate);
    newDue.setDate(newDue.getDate() + input.daysToShift);
    return {
      rescheduleFee: q.rescheduleFee.toFixed(2),
      lateFee: q.lateFee.toFixed(2),
      collectAmount: q.collectAmount.toFixed(2),
      variant: q.variant,
      newDueDate: newDue.toISOString(),
      currentDueDate: payment.dueDate.toISOString(),
    };
  }

  async executeWithCollect(input: RescheduleCollectInput): Promise<RescheduleCollectResult> {
    if (!input.daysToShift || input.daysToShift < 1) {
      throw new BadRequestException('กรุณาระบุจำนวนวันที่เลื่อน (daysToShift) มากกว่า 0');
    }

    // CR-7 parity with recordPayment: the collect JE posts today — period must be open.
    await validatePeriodOpen(this.prisma, new Date(), await resolveFinanceCompanyId(this.prisma));

    const resolvedDepositAccountCode =
      input.depositAccountCode ??
      (await resolveUserDefaultCashAccount(this.prisma, input.recordedById));

    const txResult = await this.prisma.$transaction(
      async (tx) => {
        const { contract, payment } = await this.loadRow(tx, input.contractId, input.installmentNo);

        // Quote: recompute (cashier) or honour the frozen QR quote (webhook).
        const q: RescheduleQuote = input.fixedQuote
          ? {
              rescheduleFee: d(input.fixedQuote.rescheduleFee),
              lateFee: d(input.fixedQuote.lateFee),
              collectAmount: d(input.fixedQuote.collectAmount),
              variant: input.splitMode === 'SPLIT' ? '6a' : '6b',
            }
          : await this.buildQuote(tx, contract, payment, input.daysToShift, input.splitMode);

        // Cashier cross-check: the UI quoted a number; if the server disagrees
        // (fee config changed / crossed midnight) refuse — never book silently.
        if (!input.fixedQuote && q.collectAmount.gt(0)) {
          const diff = d(input.amount).minus(q.collectAmount).abs();
          if (diff.gt(d('0.01'))) {
            throw new BadRequestException(
              `ยอดเรียกเก็บเปลี่ยนเป็น ${q.collectAmount.toFixed(2)} บาท (ค่าธรรมเนียม ${q.rescheduleFee.toFixed(2)} + ค่าปรับ ${q.lateFee.toFixed(2)}) — กรุณาเปิดหน้าต่างปรับดิวใหม่`,
            );
          }
        }

        // Evidence rule mirrors recordPayment: โอน requires slip or ref.
        if (
          q.collectAmount.gt(0) &&
          input.paymentMethod === 'BANK_TRANSFER' &&
          !input.evidenceUrl &&
          !input.transactionRef
        ) {
          throw new BadRequestException(
            'ต้อง upload หลักฐานการชำระเงิน (สลิปโอนเงิน) หรือระบุเลขอ้างอิงธุรกรรม',
          );
        }

        const instSched = await tx.installmentSchedule.findUnique({
          where: {
            contractId_installmentNo: {
              contractId: input.contractId,
              installmentNo: input.installmentNo,
            },
          },
          select: { id: true },
        });

        // 3. Collect JE — only when there is money to collect.
        let journalEntryNo: string | null = null;
        if (q.collectAmount.gt(0)) {
          const zero = new Prisma.Decimal(0);
          const lines: { accountCode: string; dr: Prisma.Decimal; cr: Prisma.Decimal; description: string }[] = [
            {
              accountCode: resolvedDepositAccountCode,
              dr: q.collectAmount,
              cr: zero,
              description: 'รับเงินปรับดิว',
            },
          ];
          if (q.variant === '6a' && q.rescheduleFee.gt(0)) {
            lines.push({
              accountCode: '21-1103',
              dr: zero,
              cr: q.rescheduleFee,
              // "เงินรับล่วงหน้า" (not "งวดสุดท้าย") — the 2A auto-consume relieves it
              // FIFO against whichever installment accrues next, not the literal last.
              description: 'เงินรับล่วงหน้า — ค่าธรรมเนียมปรับดิว (6a)',
            });
          }
          if (q.lateFee.gt(0)) {
            lines.push({
              accountCode: '42-1103',
              dr: zero,
              cr: q.lateFee,
              description: 'ค่าปรับชำระล่าช้า (เก็บตอนปรับดิว)',
            });
          }
          const je = await this.journalAutoService.createAndPost(
            {
              description: `ปรับดิวงวด #${input.installmentNo} — สัญญา ${contract.contractNumber} (เลื่อน ${input.daysToShift} วัน, ${q.variant})`,
              reference: randomUUID(),
              metadata: {
                tag: 'reschedule-collect',
                flow: 'reschedule-collect',
                contractId: contract.id,
                installmentScheduleId: instSched?.id ?? null,
                paymentId: payment.id,
                variant: q.variant,
                daysToShift: input.daysToShift,
                rescheduleFee: q.rescheduleFee.toString(),
                lateFeeCollected: q.lateFee.toString(),
              },
              lines,
            },
            tx,
          );
          journalEntryNo = je.entryNumber;
        }

        // 4. Payment-row bookkeeping (one update, both concerns):
        //    - Late fee ของช่วงเกินเดิม "เก็บแล้ว" — reset to 0 so the new overdue
        //      period (vs the new due date) accrues its own fee from a clean slate.
        //    - 6b: stamp the deferred fee as a note on THIS installment so the
        //      cashier collects (ค่างวด + fee) at the next receipt — the orchestrator's
        //      D1 auto-route then parks the overage as 21-1103 advance (CPA case 6b).
        const noteTags: string[] = [];
        if (q.lateFee.gt(0)) {
          noteTags.push(
            `ค่าปรับ ${q.lateFee.toFixed(2)} บาท เก็บแล้วตอนปรับดิว (${new Date().toISOString().slice(0, 10)})`,
          );
        }
        if (q.variant === '6b' && q.rescheduleFee.gt(0)) {
          noteTags.push(
            `ค่าธรรมเนียมปรับดิว ${q.rescheduleFee.toFixed(2)} บาท เก็บเพิ่มพร้อมงวดนี้ (6b)`,
          );
        }
        if (noteTags.length > 0) {
          const noteTag = noteTags.join(' | ');
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              ...(q.lateFee.gt(0) ? { lateFee: 0 } : {}),
              notes: payment.notes ? `${payment.notes} | ${noteTag}` : noteTag,
            },
          });
        }

        // 4b. 6a: the fee is a PREPAYMENT under the CPA model (CSV case 6a — the
        // contract total never changes; the customer just pays part of it early).
        // Credit it to the REAL advance ledger pair the rest of the system uses:
        // Cr 21-1103 (JE above) + Contract.advanceBalance — the existing machinery
        // (wizard AdvanceBalanceBanner, computeNetReceiptDue netting, orchestrator /
        // 2A auto-consume) then relieves it against upcoming installments.
        // (Review C1 2026-07-02: the old InstallmentSchedule.amountDue reduction was
        // write-only — no billing path read it — so the 21-1103 credit was never
        // relieved and the fee was effectively double-billed.)
        if (q.variant === '6a' && q.rescheduleFee.gt(0)) {
          const beforeAdvance = new Prisma.Decimal((contract.advanceBalance ?? 0).toString());
          await tx.contract.update({
            where: { id: contract.id },
            data: { advanceBalance: { increment: q.rescheduleFee } },
          });
          // Same forensic trail the orchestrator writes for every advance delta.
          await tx.auditLog.create({
            data: {
              action: 'OVERPAY_ADVANCE_RECORDED',
              entity: 'contract',
              entityId: contract.id,
              userId: input.recordedById,
              newValue: {
                paymentId: payment.id,
                installmentNo: input.installmentNo,
                advanceCredit: q.rescheduleFee.toString(),
                advanceConsume: '0',
                delta: q.rescheduleFee.toString(),
                beforeBalance: beforeAdvance.toString(),
                afterBalance: beforeAdvance.plus(q.rescheduleFee).toString(),
                source: 'RESCHEDULE_COLLECT_6A_FEE',
              },
            },
          });
        }

        // 5. Shift due dates + reduce last installment + RESCHEDULE audit — same tx.
        const reschedule = await this.rescheduleService.execute(
          {
            contractId: input.contractId,
            fromInstallmentNo: input.installmentNo,
            daysToShift: input.daysToShift,
            userId: input.recordedById,
            variant: q.variant,
          },
          tx,
        );

        // Anti-drift assert: quote fee must equal the fee RescheduleService applied.
        if (!input.fixedQuote && !reschedule.rescheduleFee.eq(q.rescheduleFee)) {
          throw new BadRequestException(
            `ค่าธรรมเนียมไม่ตรงกัน (quote ${q.rescheduleFee.toFixed(2)} ≠ execute ${reschedule.rescheduleFee.toFixed(2)}) — กรุณาลองใหม่`,
          );
        }

        // 6. Money-detail audit row (RESCHEDULE row itself is written by RescheduleService).
        await tx.auditLog.create({
          data: {
            action: 'RESCHEDULE_COLLECT',
            entity: 'payment',
            entityId: payment.id,
            userId: input.recordedById,
            newValue: {
              contractId: contract.id,
              installmentNo: input.installmentNo,
              variant: q.variant,
              daysToShift: input.daysToShift,
              rescheduleFee: q.rescheduleFee.toString(),
              lateFeeCollected: q.lateFee.toString(),
              collectAmount: q.collectAmount.toString(),
              paymentMethod: input.paymentMethod,
              transactionRef: input.transactionRef ?? null,
              evidenceUrl: input.evidenceUrl ?? null,
              depositAccountCode: q.collectAmount.gt(0) ? resolvedDepositAccountCode : null,
              journalEntryNo,
              source: input.fixedQuote ? 'QR_WEBHOOK' : 'CASHIER',
            },
          },
        });

        return {
          paymentId: payment.id,
          quote: q,
          journalEntryNo,
          shiftedInstallmentIds: reschedule.shiftedInstallmentIds,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Post-commit (I3): e-Receipt for the collected money — never rolls back the tx.
    if (d(txResult.quote.collectAmount).gt(0)) {
      try {
        await this.receiptsService.generateReceipt(
          input.contractId,
          txResult.paymentId,
          'RESCHEDULE_FEE',
          d(txResult.quote.collectAmount).toNumber(),
          input.installmentNo,
          input.paymentMethod,
          input.transactionRef || null,
          input.recordedById,
        );
      } catch (error) {
        this.logger.error(
          `Failed to generate reschedule-collect receipt (contract: ${input.contractId}, installment: ${input.installmentNo})`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return {
      success: true,
      case: 'RESCHEDULE',
      variant: txResult.quote.variant,
      rescheduleFee: txResult.quote.rescheduleFee.toFixed(2),
      lateFeeCollected: txResult.quote.lateFee.toFixed(2),
      collectAmount: txResult.quote.collectAmount.toFixed(2),
      journalEntryNo: txResult.journalEntryNo,
      shiftedInstallmentCount: txResult.shiftedInstallmentIds.length,
      shiftedInstallmentIds: txResult.shiftedInstallmentIds,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async loadRow(
    client: Prisma.TransactionClient | PrismaService,
    contractId: string,
    installmentNo: number,
  ) {
    const contract = await client.contract.findUnique({ where: { id: contractId } });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
    if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
      throw new BadRequestException('ไม่สามารถปรับดิวได้ สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE หรือ DEFAULT');
    }
    const payment = await client.payment.findFirst({
      where: { contractId, installmentNo, deletedAt: null },
    });
    if (!payment) throw new NotFoundException('ไม่พบงวดที่ต้องการ');
    if (payment.status === 'PAID') throw new BadRequestException('งวดนี้ชำระแล้ว — ไม่ต้องปรับดิว');
    return { contract, payment };
  }

  private async buildQuote(
    client: Prisma.TransactionClient | PrismaService,
    contract: { monthlyPayment: Prisma.Decimal },
    payment: { dueDate: Date; amountDue: Prisma.Decimal; lateFeeWaived: boolean },
    daysToShift: number,
    splitMode: RescheduleSplitMode,
  ): Promise<RescheduleQuote> {
    const lateFeeCfg = await loadLateFeeConfig(client as PrismaService);
    return computeRescheduleQuote({
      monthlyPayment: contract.monthlyPayment,
      daysToShift,
      splitMode,
      payment,
      lateFeeCfg,
      now: new Date(),
    });
  }
}
