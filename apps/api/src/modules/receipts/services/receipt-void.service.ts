import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { ReceiptVoidReversalTemplate } from '../../journal/cpa-templates/receipt-void-reversal.template';
import { reconstructPriorCleared } from '../../journal/reconstruct-prior';
import { ReceiptNumberService } from './receipt-number.service';
import { INSTALLMENT_MONEY_RECEIPT_TYPES } from '../receipt-types.constants';

/**
 * Contract statuses whose closing transition already moved state that an
 * un-pay cannot safely unwind (ownership released, write-off posted,
 * exchange/cancellation reversal chains, ปพพ.386 termination). Voiding a
 * receipt on any of these would resurrect an installment on a terminally
 * closed contract.
 */
const UNPAY_BLOCKED_CONTRACT_STATUSES = [
  'COMPLETED',
  'EARLY_PAYOFF',
  'TERMINATED',
  'EXCHANGED',
  'DEFECT_EXCHANGED',
  'CLOSED_BAD_DEBT',
  'CANCELED',
];

/**
 * Receipt void: the regulated money-path ($tx #2). Posts a reversal JE for each
 * matched POSTED receipt JE, creates a credit note, marks the original voided,
 * un-pays the installment (Payment revert + sibling receipts + denormalized
 * contract balances + loyalty points), and writes the RECEIPT_VOID forensic
 * audit — all atomically.
 *
 * Un-pay semantics (2026-07-08, owner decision): ยกเลิกใบเสร็จ = ยกเลิกการชำระ
 * ของงวดนั้นทั้งงวด. The ledger reversal below is already per-payment (PR 3.1
 * reverses EVERY receipt JE sharing metadata.paymentId — JEs are keyed by
 * paymentId, not receiptId), so the Payment row and sibling receipts must
 * follow or the installment never returns to the pending queue. Mirrors
 * RefundsService.markReversed. Supersedes the 2026-06-07 refund-reversal
 * design note that kept voided payments PAID.
 */
export class ReceiptVoidService {
  constructor(
    private prisma: PrismaService,
    private receiptVoidReversalTemplate: ReceiptVoidReversalTemplate,
    private numbers: ReceiptNumberService,
  ) {}

  /**
   * Resolve the FINANCE companyId for the period-lock guard. Receipts are a
   * FINANCE-side artifact (their void posts a FINANCE reversal JE). Returns
   * undefined when FINANCE is not configured so a void never crashes on
   * misconfig — FINANCE is always configured in production.
   */
  private async resolveFinanceCompanyId(): Promise<string | undefined> {
    const finance = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    return finance?.id;
  }

  /**
   * Void a receipt (ถ้าผิด → ออกใบลดหนี้/ใบแก้ไขแทน)
   * ใบเสร็จที่ออกแล้วห้ามแก้ไข/ลบ
   *
   * Wave 3 T2 (ปพพ.386 W-3): จำกัดสิทธิ์ — เฉพาะ OWNER / ACCOUNTANT /
   * BRANCH_MANAGER เท่านั้นที่ void ได้. SALES void ไม่ได้เพื่อป้องกัน
   * fraud โดยพนักงานหน้าร้าน. บันทึก audit log RECEIPT_VOID เพิ่มเติม
   * นอกเหนือจาก voidApprovedById บน receipt row เพื่อ forensic trail.
   */
  async voidReceipt(
    id: string,
    reason: string,
    issuedById: string,
    approvedById: string,
    userRole?: string,
  ) {
    if (!reason?.trim()) {
      throw new BadRequestException('กรุณาระบุเหตุผลในการยกเลิก');
    }

    // Wave 3 T2: Role check — controller passes userRole; if absent we
    // still defend in service layer (defensive — prevents future caller misuse).
    const ALLOWED_VOID_ROLES = ['OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'FINANCE_MANAGER'];
    if (userRole !== undefined && !ALLOWED_VOID_ROLES.includes(userRole)) {
      throw new ForbiddenException(
        'ไม่มีสิทธิ์ยกเลิกใบเสร็จ · ต้องเป็นเจ้าของ / ฝ่ายบัญชี / ผจก.สาขา / ผจก.การเงิน',
      );
    }

    // Segregation of duties: the user requesting the void cannot be the same
    // user approving it. Mirrors bad-debt write-off pattern (writtenOffById !==
    // approvedById). Prevents the controller fallback `dto.approvedById ?? user.id`
    // from auto-approving on behalf of the requester.
    if (issuedById === approvedById) {
      throw new ForbiddenException(
        'การยกเลิกใบเสร็จต้องมีผู้ขออนุมัติและผู้อนุมัติเป็นคนละคน',
      );
    }

    // The approver must be a real, active user with a void-capable role —
    // otherwise the SoD control is client-side only and the forensic audit
    // trail could reference a non-user. Mirrors late-fee-waiver /
    // stock-adjustments approver validation.
    const approver = await this.prisma.user.findUnique({
      where: { id: approvedById },
      select: { id: true, role: true, isActive: true, deletedAt: true },
    });
    if (!approver || approver.deletedAt || !approver.isActive) {
      throw new NotFoundException('ไม่พบผู้อนุมัติ หรือถูกปิดการใช้งาน');
    }
    if (!ALLOWED_VOID_ROLES.includes(approver.role)) {
      throw new ForbiddenException(
        'ผู้อนุมัติต้องเป็นเจ้าของ / ฝ่ายบัญชี / ผจก.สาขา / ผจก.การเงิน',
      );
    }

    // CR-7: Validate void date is not in a closed (FINANCE) accounting period.
    await validatePeriodOpen(this.prisma, new Date(), await this.resolveFinanceCompanyId());
    return this.prisma.$transaction(async (tx) => {
      const receipt = await tx.receipt.findUnique({ where: { id } });
      if (!receipt || receipt.deletedAt) throw new NotFoundException('ไม่พบใบเสร็จ');
      if (receipt.isVoided) throw new BadRequestException('ใบเสร็จนี้ถูกยกเลิกแล้ว');

      // A credit note is itself the reversal document — voiding one would try to
      // reverse the original receipt JEs a second time (the template throws
      // "already reversed" mid-tx). Refuse up-front with a clear message.
      if (receipt.receiptType === 'CREDIT_NOTE') {
        throw new BadRequestException(
          'ใบลดหนี้ไม่สามารถยกเลิกได้ — เอกสารกลับรายการต้องคงอยู่เพื่อการตรวจสอบ',
        );
      }
      // A RESCHEDULE_FEE receipt shares its paymentId with the shifted
      // installment's Payment row, but its money JE is tagged
      // 'reschedule-collect' (excluded below). Voiding it would collaterally
      // reverse the installment's GENUINE receipt JEs while leaving the
      // reschedule money + shifted due dates untouched. There is no automatic
      // un-reschedule path — refuse.
      if (receipt.receiptType === 'RESCHEDULE_FEE') {
        throw new BadRequestException(
          'ใบเสร็จค่าธรรมเนียมเลื่อนนัดยังไม่รองรับการยกเลิก — การเลื่อนดิวไม่มีเส้นทางย้อนกลับอัตโนมัติ กรุณาติดต่อผู้ดูแลระบบ',
        );
      }
      // EARLY_PAYOFF receipts carry paymentId=null and their JP4 JEs are not
      // payment-tagged — a void here would create a credit note that reverses
      // NOTHING in the ledger (document-integrity violation). Early-payoff
      // reversal needs its own flow.
      if (receipt.receiptType === 'EARLY_PAYOFF') {
        throw new BadRequestException(
          'ใบเสร็จปิดยอดก่อนกำหนดยังไม่รองรับการยกเลิก — การกลับรายการปิดยอดต้องทำผ่านผู้ดูแลระบบ',
        );
      }

      // W-006: Credit Note 30-day time limit
      const daysSinceIssue = Math.floor(
        (Date.now() - receipt.createdAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceIssue > 30) {
        throw new BadRequestException('ไม่สามารถยกเลิกใบเสร็จที่ออกเกิน 30 วัน');
      }

      // Un-pay guard: closing transitions (COMPLETED/EARLY_PAYOFF release
      // product ownership, CLOSED_BAD_DEBT posted a write-off, EXCHANGED/
      // DEFECT_EXCHANGED/CANCELED have their own reversal chains, TERMINATED is
      // ปพพ.386-final). Un-paying an installment here cannot safely unwind
      // those — refuse and route to the refund flow / manual handling instead
      // of leaving contract state divergent.
      const contract = await tx.contract.findUnique({
        where: { id: receipt.contractId },
        select: { id: true, status: true },
      });
      if (contract && UNPAY_BLOCKED_CONTRACT_STATUSES.includes(contract.status)) {
        throw new BadRequestException(
          `สัญญานี้อยู่ในสถานะปิดแล้ว (${contract.status}) — การยกเลิกใบเสร็จจะทำให้สถานะสัญญาและกรรมสิทธิ์สินค้าไม่สอดคล้อง กรุณาใช้ระบบคืนเงิน (Refund) หรือติดต่อผู้ดูแลระบบ`,
        );
      }

      // Generate credit note number inside transaction (uses FOR UPDATE lock)
      const creditNoteNumber = await this.numbers.generateReceiptNumber(tx);
      const creditNote = await tx.receipt.create({
        data: {
          receiptNumber: creditNoteNumber,
          contractId: receipt.contractId,
          paymentId: receipt.paymentId,
          receiptType: 'CREDIT_NOTE',
          payerName: receipt.payerName,
          receiverName: receipt.receiverName,
          amount: receipt.amount,
          installmentNo: receipt.installmentNo,
          paymentMethod: receipt.paymentMethod,
          paidDate: new Date(),
          voidedReceiptId: receipt.id,
          issuedById,
        },
      });

      // Mark original as voided with approval trail
      await tx.receipt.update({
        where: { id },
        data: {
          isVoided: true,
          voidReason: reason.trim(),
          voidApprovedById: approvedById,
          voidApprovedAt: new Date(),
        },
      });

      // Phase A.5a: reverse the payment's receipt JE(s).
      // Must propagate errors — a receipt void without FULL ledger reversal would
      // leave HP receivable cleared by the receipt JE(s) but no offsetting credit
      // note JE.
      //
      // PR-843/I2 Phase 3 PR 3.1 — reverse ALL receipt JEs of the payment, not just
      // one. The epic posts MULTIPLE receipt JEs per Payment (a partial then a
      // completion); each JE now carries a fresh unique `reference`, so the old
      // `referenceId == paymentId` lookup found at most ONE and left the other
      // receipt's Cr 11-2103 un-reversed = ledger defect. The canonical payment→JE
      // link is `metadata.paymentId`, which every receipt path stamps (the primitive,
      // the legacy 2B full/2B-split-final templates, and applyCreditBalance's
      // credit-allocation JE). findMany + reverse EACH is backward-compatible: a
      // single-receipt payment returns one JE → one reversal (same as before).
      // Un-pay bookkeeping collected for the audit trail + response.
      let paymentReverted: {
        paymentId: string;
        fromStatus: string;
        toStatus: string;
        previousAmountPaid: string;
        survivingAmountPaid: string;
      } | null = null;
      let voidedSiblingReceipts = 0;
      let advanceAdj = new Prisma.Decimal(0);
      let creditAdj = new Prisma.Decimal(0);

      if (receipt.paymentId) {
        // FINAL-REVIEW BLOCKER 2 — restrict the reversal to TRUE receivable-clearing
        // receipt JEs. autoAllocate's overpayment JE shares the same metadata.paymentId
        // but carries tag:'overpayment-credit' (Dr cash / Cr 21-5101 customer credit);
        // reversing it on a receipt void would phantom-Dr 21-5101/Cr cash and leave the
        // creditBalance un-restored. The tag filter excludes it (and any
        // paysolutions-surplus-advance, which has no paymentId). The advance-consume 2B
        // JE also has no paymentId so it is already not matched.
        const matchedEntries = await tx.journalEntry.findMany({
          where: {
            AND: [
              { metadata: { path: ['paymentId'], equals: receipt.paymentId } } as any,
              {
                OR: [
                  { metadata: { path: ['tag'], equals: 'receipt' } } as any,
                  { metadata: { path: ['tag'], equals: '2B' } } as any,
                  // legacy credit-funded clears (applyCreditBalance credit-allocation JE)
                  { metadata: { path: ['tag'], equals: 'credit-allocation' } } as any,
                ],
              },
              { status: 'POSTED' },
              { deletedAt: null },
            ],
          },
          include: { lines: true },
        });
        // Skip originals already reversed by a PRIOR void/refund cycle — their
        // status stays POSTED forever (only metadata.reversed flips), so after
        // a void → re-pay cycle they still match here and the reversal template
        // would throw "already reversed", bricking every later void. Filtered
        // in JS, not SQL: a Postgres JSON-path equality on a missing key yields
        // NULL, so a SQL NOT(...) would silently drop never-reversed JEs too.
        const originalEntries = matchedEntries.filter(
          (e) => (e.metadata as any)?.reversed !== true,
        );
        for (const originalEntry of originalEntries) {
          await this.receiptVoidReversalTemplate.voidReceipt(originalEntry.id, tx);
          // Denormalized-balance restore: the reversal flips the 21-1103 /
          // 21-5101 LEDGER legs, but Contract.advanceBalance /
          // Contract.creditBalance are plain columns written by the
          // orchestrator — without this they permanently diverge from the
          // ledger (and the 2A accrual cron keeps consuming the phantom
          // advance). Original Dr 21-1103 = advance consumed (give it back);
          // original Cr 21-1103 = overpay parked as advance (take it back).
          // Original Dr 21-5101 = credit consumed by applyCreditBalance
          // (give it back); matched tags never Cr 21-5101.
          for (const line of (originalEntry as any).lines ?? []) {
            if (line.accountCode === '21-1103') {
              advanceAdj = advanceAdj
                .plus(new Prisma.Decimal(line.debit ?? 0))
                .minus(new Prisma.Decimal(line.credit ?? 0));
            } else if (line.accountCode === '21-5101') {
              creditAdj = creditAdj.plus(new Prisma.Decimal(line.debit ?? 0));
            }
          }
        }
        // Zero found (legacy no-JE payment) → graceful skip (unchanged behaviour).

        if (!advanceAdj.isZero() || !creditAdj.isZero()) {
          const updatedContract = await tx.contract.update({
            where: { id: receipt.contractId },
            data: {
              ...(advanceAdj.isZero() ? {} : { advanceBalance: { increment: advanceAdj } }),
              ...(creditAdj.isZero() ? {} : { creditBalance: { increment: creditAdj } }),
            },
          });
          // A parked advance may have been consumed by ANOTHER installment
          // before this void takes it back — the balance then goes negative.
          // Nothing crashes (every consumer guards .gt(0)) but it means money
          // already spent elsewhere can no longer be accounted cleanly — alarm
          // ops instead of failing the void.
          if (
            updatedContract.advanceBalance != null &&
            new Prisma.Decimal(updatedContract.advanceBalance).isNegative()
          ) {
            Sentry.captureMessage('Receipt void drove Contract.advanceBalance negative', {
              level: 'warning',
              extra: {
                contractId: receipt.contractId,
                receiptId: receipt.id,
                advanceBalance: updatedContract.advanceBalance.toString(),
                advanceAdj: advanceAdj.toString(),
              },
            });
          }
        }

        // Un-pay the installment. The reversal above re-opened the receivable
        // for EVERY receipt JE of this Payment, so the Payment row must stop
        // claiming PAID and the sibling receipts must not stay valid — mirrors
        // RefundsService.markReversed. OVERDUE vs PENDING is decided here
        // because the read side does NO due-date comparison (the cron only
        // flips PENDING→OVERDUE at its next run).
        const payment = await tx.payment.findUnique({
          where: { id: receipt.paymentId },
          select: {
            id: true,
            status: true,
            amountPaid: true,
            amountDue: true,
            dueDate: true,
            contractId: true,
            installmentNo: true,
            deletedAt: true,
          },
        });
        if (payment && !payment.deletedAt) {
          // NOT everything the customer cleared is reversible above: the 2A
          // accrual cron's advance-auto-consume JE carries no metadata.paymentId
          // (and creates no receipt), so it survives the reversal — blindly
          // zeroing amountPaid would then under-state the installment and the
          // next full collection would trip the ≤1฿ tolerance guard. Recompute
          // the surviving cleared amount from the ledger instead (reversed
          // originals are skipped by reconstructPriorCleared).
          let survivingPaid = new Prisma.Decimal(0);
          const schedule = await tx.installmentSchedule.findUnique({
            where: {
              contractId_installmentNo: {
                contractId: payment.contractId,
                installmentNo: payment.installmentNo,
              },
            },
            select: { id: true },
          });
          if (schedule) {
            const prior = await reconstructPriorCleared(
              tx,
              schedule.id,
              new Prisma.Decimal(payment.amountDue),
            );
            survivingPaid = prior.priorPrincipalCleared.plus(prior.priorLateFeeBooked);
          }
          const fullyReverted = survivingPaid.lte(0);
          const revertStatus = fullyReverted
            ? payment.dueDate < new Date()
              ? 'OVERDUE'
              : 'PENDING'
            : 'PARTIALLY_PAID';
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: revertStatus,
              amountPaid: fullyReverted ? 0 : survivingPaid,
              paidDate: null,
            },
          });
          const siblings = await tx.receipt.updateMany({
            where: {
              paymentId: payment.id,
              id: { not: receipt.id },
              isVoided: false,
              deletedAt: null,
              // Only installment-money siblings get voided together: CN rows
              // are reversal documents, RESCHEDULE_FEE money lives in the
              // (untouched) reschedule-collect JE — both stay valid. Shared
              // constant keeps this aligned with issuance/PDF/fee-display.
              receiptType: { in: [...INSTALLMENT_MONEY_RECEIPT_TYPES] },
            },
            data: {
              isVoided: true,
              voidReason: `ยกเลิกพร้อมใบเสร็จ ${receipt.receiptNumber}: ${reason.trim()}`,
              voidApprovedById: approvedById,
              voidApprovedAt: new Date(),
            },
          });
          voidedSiblingReceipts = siblings.count;
          // Loyalty points were awarded for this (now un-paid) payment.
          await tx.loyaltyPoint.updateMany({
            where: { paymentId: payment.id, deletedAt: null },
            data: { deletedAt: new Date() },
          });
          paymentReverted = {
            paymentId: payment.id,
            fromStatus: payment.status,
            toStatus: revertStatus,
            previousAmountPaid: payment.amountPaid.toString(),
            survivingAmountPaid: survivingPaid.toString(),
          };
        }
      }

      // Wave 3 T2 (ปพพ.386 W-3): forensic audit log for receipt voids.
      // voidApprovedById on receipt is operational; this is the immutable
      // tamper-evident trail (Merkle-chained, 7-yr retention).
      await tx.auditLog.create({
        data: {
          userId: issuedById,
          action: 'RECEIPT_VOID',
          entity: 'receipt',
          entityId: receipt.id,
          oldValue: {
            receiptNumber: receipt.receiptNumber,
            amount: Number(receipt.amount),
            payerName: receipt.payerName,
            paymentMethod: receipt.paymentMethod,
            installmentNo: receipt.installmentNo,
            paidDate: receipt.paidDate.toISOString(),
          },
          newValue: {
            reason: reason.trim(),
            voidedAt: new Date().toISOString(),
            approvedById,
            creditNoteId: creditNote.id,
            creditNoteNumber: creditNote.receiptNumber,
            userRole: userRole ?? null,
            // Un-pay trail (2026-07-08)
            paymentReverted,
            voidedSiblingReceipts,
            advanceBalanceRestored: advanceAdj.isZero() ? null : advanceAdj.toString(),
            creditBalanceRestored: creditAdj.isZero() ? null : creditAdj.toString(),
          },
        },
      });

      return { voidedReceipt: receipt, creditNote, paymentReverted };
    });
  }
}
