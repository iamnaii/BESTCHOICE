import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineOaService } from '../../line-oa/line-oa.service';
import { FlexTemplatesService } from '../../line-oa/flex-templates.service';
import { QuickReplyService } from '../../line-oa/quick-reply.service';
import { PromiseService } from '../../overdue/promise.service';
import { MdmLockService } from '../../overdue/mdm-lock.service';
import { formatDateShort } from '../../../utils/thai-date.util';

/**
 * Post-commit side-effects that run OUTSIDE the regulated money $transaction by
 * design (the I3 ordering): loyalty points, LINE push, and the promise-to-pay
 * kept-detection hook (which owns its OWN Serializable $tx). None of these may
 * roll back a committed payment — all are non-financial / idempotent / logged on
 * failure. Bodies moved verbatim from the legacy PaymentsService.
 *
 * Constructed internally by PaymentsService. The facade exposes thin delegations
 * (awardLoyaltyPoints / sendPaymentSuccessLine / checkPromiseAfterPayment /
 * getSystemUserId) so the existing specs that call/spy them on the facade stay
 * green.
 */
@Injectable()
export class PaymentPostCommitHooks {
  private readonly logger = new Logger(PaymentPostCommitHooks.name);

  constructor(
    private prisma: PrismaService,
    private promiseService: PromiseService | undefined,
    private mdmLockService: MdmLockService | undefined,
    private lineOaService: LineOaService,
    private flexTemplates: FlexTemplatesService,
    private quickReplyService: QuickReplyService,
  ) {}

  // ─── Award loyalty points for on-time payment ──────────
  async awardLoyaltyPoints(
    customerId: string,
    contractId: string,
    paymentId: string,
    amount: number,
    paidDate: Date | null,
    dueDate: Date,
  ) {
    // Only award for on-time payments (ชำระตรงเวลาหรือก่อนกำหนด)
    if (!paidDate || paidDate > dueDate) return;

    const points = Math.floor(amount / 100); // 1 point per 100 baht
    if (points <= 0) return;

    try {
      // Idempotent upsert: paymentId is unique — safe to call multiple times
      await this.prisma.loyaltyPoint.upsert({
        where: { paymentId },
        create: { customerId, paymentId, contractId, points, reason: 'ON_TIME_PAYMENT' },
        update: {}, // Already awarded — do nothing
      });
    } catch (error) {
      this.logger.error(
        `Failed to award loyalty points for payment ${paymentId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Send LINE push notification after successful payment.
   * Sends Flex Message with Quick Reply (afterPayment preset).
   * Respects customer notification preferences.
   */
  async sendPaymentSuccessLine(
    contractId: string,
    installmentNo: number,
    amount: number,
    paymentMethod: string,
  ): Promise<void> {
    try {
      const contract = await this.prisma.contract.findUnique({
        where: { id: contractId },
        select: {
          contractNumber: true,
          totalMonths: true,
          customer: { select: { lineIdFinance: true, name: true, notifReceipt: true } },
        },
      });
      if (!contract?.customer?.lineIdFinance || !contract.customer.notifReceipt) return;

      // I6 fix: include deletedAt: null so soft-deleted payments don't
      // inflate the "X / N" counter shown in the LINE receipt.
      const paidCount = await this.prisma.payment.count({
        where: { contractId, status: 'PAID', deletedAt: null },
      });
      const remaining = contract.totalMonths - paidCount;

      const flex = this.flexTemplates.paymentReceipt({
        contractNumber: contract.contractNumber,
        installmentNo,
        totalInstallments: contract.totalMonths,
        amount,
        date: formatDateShort(new Date()),
      });

      // Attach Quick Reply so customer can quickly check balance, receipt, or contract
      flex.quickReply = { items: this.quickReplyService.afterPayment() };

      await this.lineOaService.sendFlexMessage(contract.customer.lineIdFinance, flex, 'line-finance');

      this.logger.log(
        `[LINE] Payment success flex sent for contract ${contract.contractNumber} ` +
          `installment ${installmentNo}/${contract.totalMonths} remaining=${Math.max(0, remaining)}`,
      );
    } catch (err) {
      this.logger.warn(`LINE push failed for contract ${contractId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ─── Promise-to-pay kept-detection ────────────────────
  // Called non-blocking after every payment tx commits. Checks whether any
  // active promise-to-pay cycle is fully satisfied and, if so, marks it kept
  // and auto-unlocks the MDM device.
  async checkPromiseAfterPayment(contractId: string): Promise<void> {
    if (!this.promiseService || !this.mdmLockService) return;
    const active = await this.promiseService.findActivePromise(contractId);
    if (!active) return;

    const now = new Date();
    const systemUserId = await this.getSystemUserId();

    // H1 + M4 fix: wrap slot resolution + keptPromiseCount increment in a single
    // Serializable transaction so partial failure can't leave slots updated but
    // counter unchanged, and concurrent payments can't double-increment the counter.
    // The callLog.updateMany guard ensures only one concurrent caller promotes the
    // promise to "kept" — the loser's transaction sees keptAt already set and bails out.
    const promoted = await this.prisma.$transaction(
      async (tx) => {
        let allKept = true;
        // N2 fix: targets are cumulative through each slot, and each slot's
        // paidAmount is its own contribution (settlementAmount), not the
        // contract-wide sum. Previously we compared cumulative paid against the
        // per-slot amount alone — slot N would get falsely satisfied as soon as
        // the customer overpaid slot N-1.
        let cumulativeTarget = 0;

        for (const slot of active.slots) {
          const slotAmount = (slot.settlementAmount as Prisma.Decimal).toNumber();
          cumulativeTarget += slotAmount;

          if (slot.keptAt) continue;
          if (slot.brokenAt) {
            allKept = false;
            continue;
          }

          const windowEnd = new Date(slot.settlementDate.getTime() + 1 * 86400 * 1000);
          const cycleStart = active.cycleStartedAt ?? active.createdAt;
          const sum = await tx.payment.aggregate({
            where: {
              contractId,
              deletedAt: null,
              OR: [
                { paidAt: { not: null, gte: cycleStart, lte: windowEnd } },
                { paidDate: { not: null, gte: cycleStart, lte: windowEnd } },
              ],
            },
            _sum: { amountPaid: true },
          });
          const paid = (sum._sum.amountPaid as Prisma.Decimal | null)?.toNumber() ?? 0;

          if (paid >= cumulativeTarget) {
            await tx.promiseSlot.update({
              where: { id: slot.id },
              data: {
                keptAt: now,
                paidAmount: slotAmount as unknown as Prisma.Decimal,
              },
            });
          } else {
            allKept = false;
          }
        }

        if (!allKept) return false;

        // Guarded promotion: only the first caller flips keptAt.
        const guard = await tx.callLog.updateMany({
          where: { id: active.id, keptAt: null },
          data: { keptAt: now },
        });
        if (guard.count === 0) return false;

        await tx.contract.update({
          where: { id: contractId },
          data: { keptPromiseCount: { increment: 1 } },
        });
        await tx.auditLog.create({
          data: {
            action: 'KEPT_PROMISE',
            entity: 'contract',
            entityId: contractId,
            userId: systemUserId,
            newValue: { callLogId: active.id, source: 'PAYMENT_HOOK' },
          },
        });
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (promoted) {
      // External MDM call runs only after tx commits — avoids orphan unlock on rollback.
      await this.mdmLockService!.autoUnlock(contractId, 'CYCLE_KEPT', systemUserId);
    }
  }

  async getSystemUserId(): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { isSystemUser: true },
      select: { id: true },
    });
    if (!user) throw new Error('System user not found');
    return user.id;
  }
}
