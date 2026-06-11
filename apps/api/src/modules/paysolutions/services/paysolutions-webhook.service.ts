import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Prisma, PaymentMethod } from '@prisma/client';
import type { PartialPaymentLink } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineOaService } from '../../line-oa/line-oa.service';
import { buildPaymentSuccessFlex } from '../../line-oa/flex-messages/payment-success.flex';
import { buildEarlyPayoffSuccessFlex } from '../../line-oa/flex-messages/early-payoff-success.flex';
import { ProductsService } from '../../products/products.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { PaymentReceiptTemplate } from '../../journal/cpa-templates/payment-receipt.template';
import { Vat60dayReversalTemplate } from '../../journal/cpa-templates/vat-60day-reversal.template';
import { formatDateLong } from '../../../utils/thai-date.util';
import { ensureInstallmentSchedules } from '../../../utils/installment-schedule.util';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { PaySolutionsGatewayClient } from './paysolutions-gateway.client';

/**
 * Cross-seam host the webhook routes through. The facade implements this and is
 * passed into the webhook ctor so that routing branches + post-tx notification
 * calls dispatch THROUGH the facade's own (test-spyable) public/private surface
 * — preserving the existing specs that spy on the facade instance.
 */
export interface PaySolutionsWebhookHost {
  handlePartialPaymentCallback(
    link: PartialPaymentLink,
    webhookData: Record<string, string>,
  ): Promise<void>;
  confirmSavingPlanPayment(
    savingPlanId: string,
    paymentLinkId: string,
    webhookData: Record<string, string>,
  ): Promise<void>;
  confirmOnlineOrderPayment(
    onlineOrderId: string,
    webhookData: Record<string, string>,
  ): Promise<void>;
  sendPaymentSuccessNotification(
    contractId: string,
    paymentId: string | null,
  ): Promise<void>;
  sendEarlyPayoffSuccessNotification(
    contractId: string,
    paidAmount: Prisma.Decimal,
  ): Promise<void>;
}

/**
 * REGULATED CORE — owns webhook verification + the installment money
 * distribution. The line-1105 Serializable `$transaction` (claim/idempotency
 * gate, FIFO Payment.update loop, contract-close, ensureInstallmentSchedules,
 * transferOwnership, per-installment PaymentReceiptTemplate + Vat60dayReversal
 * JEs, surplus-advance JE + advanceBalance + audit) lives here AS ONE ATOM —
 * never split, never crossing a seam. The C2 fix that moved JE posting INSIDE
 * the tx is preserved verbatim.
 *
 * Routing branches (partial / saving-plan / online-order) and the post-tx
 * notifications dispatch through {@link PaySolutionsWebhookHost} (the facade),
 * so no transaction ever crosses the seam. Constructed internally by
 * {@link PaySolutionsService}.
 */
@Injectable()
export class PaySolutionsWebhookService {
  private readonly logger = new Logger(PaySolutionsWebhookService.name);

  constructor(
    private gateway: PaySolutionsGatewayClient,
    private prisma: PrismaService,
    private lineOaService: LineOaService,
    private productsService: ProductsService,
    private journalAutoService: JournalAutoService,
    private paymentReceiptTemplate: PaymentReceiptTemplate,
    private vat60Reversal: Vat60dayReversalTemplate,
    private host: PaySolutionsWebhookHost,
  ) {}

  /**
   * ตรวจสอบ webhook callback จาก Pay Solutions
   * Pay Solutions ส่ง form POST กลับมาพร้อม merchantid — ตรวจว่าตรงกับ config
   */
  async verifyWebhookMerchant(merchantid: string): Promise<boolean> {
    const merchantId = await this.gateway.getMerchantId();
    if (!merchantId) {
      this.logger.error('PAYSOLUTIONS_MERCHANT_ID not configured — rejecting all webhooks for security');
      return false;
    }

    const isValid = merchantid === merchantId;
    if (!isValid) {
      this.logger.warn(
        `Webhook merchantid mismatch: received=${merchantid}, expected=${merchantId}`,
      );
    }
    return isValid;
  }

  /**
   * จัดการ webhook callback จาก Pay Solutions
   * อัปเดตสถานะ payment ใน DB
   */
  async handlePaymentCallback(webhookData: Record<string, string>): Promise<void> {
    const { refno, result_code, order_no, transaction_id, total } = webhookData;

    this.logger.log(
      `Webhook received: refno=${refno}, result_code=${result_code}, order_no=${order_no}`,
    );

    // ── Partial-payment QR path (cashier-initiated, separate table) ──
    // Check first because PartialPaymentLink and PaymentLink share the
    // numeric orderRef format — without this we'd fall through and hit
    // "unknown refno" Sentry alarms for every partial-payment webhook.
    const partialLink = await this.prisma.partialPaymentLink.findUnique({
      where: { token: refno },
    });
    if (partialLink) {
      await this.host.handlePartialPaymentCallback(partialLink, webhookData);
      return;
    }

    // หา payment ด้วย token — ไม่ filter status เพราะ PaySolutions retry
    // policy คือถ้า webhook ของเราตอบช้า/ผิด เขาจะ retry (max 3 ครั้ง).
    // ครั้งที่ 2/3 link.status จะเป็น USED แล้ว — ถ้า filter ACTIVE จะเข้าใจผิด
    // ว่า "unknown refno" และส่ง Sentry fatal alarm
    const paymentLink = await this.prisma.paymentLink.findFirst({
      where: { token: refno },
      include: { payment: true },
    });

    if (!paymentLink) {
      this.logger.warn(`Webhook for unknown refno: ${refno}`);
      // ถ้า webhook เป็น SUCCESS แต่หา PaymentLink ไม่เจอ — ลูกค้าจ่ายเงินจริง
      // แต่ระบบไม่มี record → ต้องให้ ops รู้ทันทีเพื่อ reconcile manual
      if (result_code === '00') {
        Sentry.captureMessage(
          `PaySolutions SUCCESS webhook for unknown refno: ${refno}`,
          {
            level: 'fatal',
            tags: {
              critical: 'paysolutions-orphan-payment',
              refno,
              transactionId: transaction_id || 'unknown',
            },
            extra: { webhookData },
          },
        );
      }
      return; // ไม่ throw — return 200 OK ให้ Pay Solutions
    }

    // IDEMPOTENCY: ถ้า link ถูกใช้ไปแล้ว (link.status === 'USED') แสดงว่า
    // เป็น duplicate webhook — log แล้ว return 200 ทันที ไม่ทำอะไร.
    // ถ้าไม่เช็คตรงนี้ Payment.amountPaid จะถูก double-count ทุกครั้งที่
    // PaySolutions retry webhook
    if (paymentLink.status === 'USED') {
      this.logger.log(
        `Duplicate webhook for refno=${refno} (link already USED, idempotent skip)`,
      );
      return;
    }

    // ถ้า link ถูก expire ไปแล้วแต่มี webhook callback มา — log warn
    // และ skip (ไม่ใช่ orphan, ลูกค้าอาจปล่อย session ค้างก่อนชำระ)
    if (paymentLink.status === 'EXPIRED') {
      this.logger.warn(
        `Webhook for EXPIRED link refno=${refno} result_code=${result_code} — ignoring`,
      );
      return;
    }

    // Saving-plan path (Phase 3): PaymentLink.savingPlanId set — route to saving plan flow.
    if (paymentLink.savingPlanId) {
      const isSuccessSaving = result_code === '00';
      if (isSuccessSaving) {
        await this.host.confirmSavingPlanPayment(paymentLink.savingPlanId, paymentLink.id, webhookData);
        await this.prisma.paymentLink.update({
          where: { id: paymentLink.id },
          data: { status: 'USED', usedAt: new Date() },
        });
      } else {
        await this.prisma.paymentLink.update({
          where: { id: paymentLink.id },
          data: { status: 'EXPIRED' },
        });
        this.logger.log(
          `Saving-plan payment FAILED: refno=${refno}, result_code=${result_code}`,
        );
      }
      return;
    }

    // Online-order path: PaymentLink without contractId belongs to an OnlineOrder.
    // Route to separate flow — does not touch Contract/Payment tables.
    if (!paymentLink.contractId) {
      const order = await this.prisma.onlineOrder.findFirst({
        where: { paymentLinkId: paymentLink.id },
      });
      if (!order) {
        this.logger.warn(
          `Webhook refno=${refno}: paymentLink has no contractId and no matching OnlineOrder — orphan?`,
        );
        return;
      }
      const isSuccessOnline = result_code === '00';
      if (isSuccessOnline) {
        await this.host.confirmOnlineOrderPayment(order.id, webhookData);
        await this.prisma.paymentLink.update({
          where: { id: paymentLink.id },
          data: { status: 'USED', usedAt: new Date() },
        });
      } else {
        await this.prisma.paymentLink.update({
          where: { id: paymentLink.id },
          data: { status: 'EXPIRED' },
        });
        this.logger.log(
          `Online order payment FAILED: refno=${refno}, result_code=${result_code}`,
        );
      }
      return;
    }

    const isSuccess = result_code === '00';

    if (isSuccess) {
      // Safely parse the webhook `total`. Falls back to the link's stored
      // amount (authoritative for early-payoff links) when the wire value
      // is malformed or absent.
      let paidAmount: Prisma.Decimal;
      try {
        paidAmount =
          total && !isNaN(Number(total)) && Number.isFinite(Number(total))
            ? new Prisma.Decimal(total)
            : paymentLink.amount;
      } catch {
        paidAmount = paymentLink.amount;
      }

      // F-1-003: Resolve FINANCE companyId + load contract metadata BEFORE the
      // transaction so the payment JE can be posted with explicit company
      // (HP receivable is FINANCE-side activity). Matches PaymentsService
      // pattern (resolveFinanceCompanyId hoisted out of $transaction).
      const financeCompany = await this.prisma.companyInfo.findFirst({
        where: { companyCode: 'FINANCE', deletedAt: null },
        select: { id: true },
      });
      const financeCompanyId = financeCompany?.id ?? null;
      // Phase A.1b: SHOP companyId for the SHOP-side commission JE leg.
      const shopCompany = await this.prisma.companyInfo.findFirst({
        where: { companyCode: 'SHOP', deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      const shopCompanyId = shopCompany?.id ?? null;
      const contractForJe = await this.prisma.contract.findUnique({
        where: { id: paymentLink.contractId! },
        select: { id: true, contractNumber: true, branchId: true },
      });

      // Period-lock: the receipt JE posts to today's FINANCE period (postedAt=now).
      // Mirror PaymentsService.recordPayment so an autonomous webhook cannot post into a
      // CLOSED/SYNCED period past its grace window. For the current month this never
      // throws (grace covers "today"); it only blocks a genuinely-closed current period.
      await validatePeriodOpen(this.prisma, new Date(), financeCompanyId ?? undefined);

      // F-1-003 follow-up: resolve a real OWNER user.id for JournalEntry.createdById.
      // The previous fix passed the literal string 'paysolutions-webhook' which
      // would always violate the FK to User.id in production. Pattern matches
      // data-audit.service.ts:1023 (system user lookup for backfill operations).
      const systemUser = await this.prisma.user.findFirst({
        where: { role: 'OWNER', deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      const systemUserId = systemUser?.id ?? null;
      if (!systemUserId) {
        // No OWNER user found — skip JE entirely and alert. Webhook still
        // proceeds (P2: payment must commit; JE is reconciled manually).
        Sentry.captureMessage(
          'PaySolutions webhook: no OWNER user found for JE creation',
          { level: 'error', tags: { module: 'paysolutions' } },
        );
      }

      // ชำระสำเร็จ — distribute paid amount FIFO across unpaid installments.
      // Early-payoff links carry amount = full payoff (with discount) and
      // must close every pending installment, not just paymentLink.paymentId.
      // Single-installment payments behave identically: one installment ends
      // up fully paid, subsequent iterations stop at remaining <= 0.
      //
      // Serializable isolation matches contract-payment.earlyPayoff so two
      // concurrent webhook retries cannot read stale amountPaid and
      // double-credit an installment. The updateMany gate on `status: ACTIVE`
      // is the belt-and-suspenders claim — only one transaction wins.
      //
      // C2 fix (2026-05-14): JE post is now INSIDE this $transaction so a JE
      // failure rolls back the Payment.update — no orphan PAID rows without
      // ledger entries. Idempotency is preserved by the paymentLink.updateMany
      // gate above (only one tx wins) and by the existing UNIQUE constraint
      // on transactionRef.
      const result = await this.prisma.$transaction(
        async (tx) => {
          const claim = await tx.paymentLink.updateMany({
            where: { id: paymentLink.id, status: 'ACTIVE' },
            data: { status: 'USED', usedAt: new Date() },
          });
          if (claim.count === 0) {
            return { alreadyClaimed: true as const };
          }

          const unpaidPayments = await tx.payment.findMany({
            where: {
              contractId: paymentLink.contractId!,
              status: { not: 'PAID' },
              deletedAt: null,
            },
            orderBy: { installmentNo: 'asc' },
          });

          let remaining = paidAmount;
          const now = new Date();
          let fullyPaidCount = 0;
          // PR-843/I2 Phase 3 3b: collect a snapshot for EVERY touched installment
          // (partial AND completing), not just fully-paid ones. After the
          // per-installment Payment.update loop we post one PaymentReceiptTemplate
          // JE per touched snapshot inside this same $transaction (C2 atomicity).
          // `payThis` is the DELTA applied THIS webhook (NOT cumulative amountPaid)
          // so the primitive clears only what each receipt covers. `isFinalReceipt`
          // = the `fullyPaid` flag so a completing receipt can close the ≤1฿ residual.
          const touchedSnapshots: Array<{
            id: string;
            installmentNo: number;
            payThis: Prisma.Decimal;
            isFinalReceipt: boolean;
            lateFee: Prisma.Decimal;
          }> = [];
          for (const payment of unpaidPayments) {
            if (remaining.lte(0)) break;
            // lateFeeWaived=true sets lateFee=0 elsewhere, so reading lateFee
            // directly is equivalent — we keep the guard explicit to be
            // defensive against future model changes.
            const lateFee = payment.lateFeeWaived
              ? new Prisma.Decimal(0)
              : payment.lateFee;
            const owed = payment.amountDue.add(lateFee).sub(payment.amountPaid);
            if (owed.lte(0)) continue;

            const payThis = Prisma.Decimal.min(remaining, owed);
            remaining = remaining.sub(payThis);
            const newAmountPaid = payment.amountPaid.add(payThis).toDecimalPlaces(2);
            const fullyPaid = newAmountPaid.gte(payment.amountDue.add(lateFee));

            const paymentUpdated = await tx.payment.update({
              where: { id: payment.id },
              data: {
                amountPaid: newAmountPaid,
                status: fullyPaid ? 'PAID' : 'PARTIALLY_PAID',
                ...(fullyPaid ? { paidDate: now, paidAt: now } : {}),
                paymentMethod: PaymentMethod.ONLINE_GATEWAY,
                gatewayRef: refno,
                gatewayStatus: 'SUCCESS',
                gatewayResponse: webhookData as object,
                notes: `ชำระผ่าน Pay Solutions (${transaction_id || refno})${
                  unpaidPayments.length > 1 && fullyPaid ? ' [ปิดก่อนกำหนด]' : ''
                }`,
              },
            });
            if (fullyPaid) {
              fullyPaidCount++;
            }
            // Capture a snapshot for EVERY touched installment (partial + final).
            // `lateFee` honours lateFeeWaived → 0 (same value the loop computed).
            touchedSnapshots.push({
              id: paymentUpdated.id,
              installmentNo: paymentUpdated.installmentNo,
              payThis,
              isFinalReceipt: fullyPaid,
              lateFee,
            });
          }

          // Close the contract when no installments remain. EARLY_PAYOFF
          // only when a single webhook closed >1 installments at once (the
          // discount-bearing LIFF flow). A normal last-installment payment
          // that happens to zero the ledger gets COMPLETED instead — matches
          // payments.service.checkContractCompletion semantics so dashboard
          // queries (COMPLETED vs EARLY_PAYOFF) stay consistent.
          const stillUnpaid = await tx.payment.count({
            where: {
              contractId: paymentLink.contractId!,
              status: { not: 'PAID' },
              deletedAt: null,
            },
          });

          let contractStatus: 'EARLY_PAYOFF' | 'COMPLETED' | null = null;
          if (stillUnpaid === 0) {
            contractStatus = fullyPaidCount > 1 ? 'EARLY_PAYOFF' : 'COMPLETED';
            const updated = await tx.contract.update({
              where: { id: paymentLink.contractId! },
              data: {
                status: contractStatus,
                ...(contractStatus === 'EARLY_PAYOFF' ? { creditBalance: 0 } : {}),
              },
              select: { productId: true },
            });
            if (updated.productId) {
              try {
                await this.productsService.transferOwnership(
                  updated.productId,
                  null,
                  tx,
                );
              } catch (err) {
                this.logger.error(
                  `Failed to release product ownership for contract ${paymentLink.contractId}: ${err instanceof Error ? err.message : err}`,
                );
              }
            }
          }

          // PR-843/I2 Phase 3 3b: post one PaymentReceiptTemplate primitive JE
          // per TOUCHED installment (partial AND completing) INSIDE this tx (C2
          // atomicity — a JE throw rolls back the Payment.update, no orphan PAID
          // rows). `delta = snapshot.payThis` is the per-receipt DELTA (NOT the
          // cumulative amountPaid), so the primitive's reconstructPrior accounts
          // for any prior partial (incl. a cashier partial posted via
          // recordPayment) and cross-path completion does NOT double-clear.
          // This also LEDGERS partials — each posts its own receipt JE (fixes the
          // pre-3b defect where partials were unledgered and the JE base was the
          // cumulative double-count). lateFee → Cr 42-1103 (honours lateFeeWaived).
          // When the installment carried a 60-day mandatory VAT flag, the matching
          // reversal posts in the same tx so 21-2103 / 11-2104 clear 1:1.
          if (contractForJe && systemUserId) {
            // Legacy contracts activated before PR #753 may have no
            // installment_schedules rows; without them the receipt JE below
            // would be silently skipped, leaving a PAID installment with no
            // ledger entry (TB overstates receivable / understates cash + VAT
            // under-reported). Lazily materialise the schedule inside this same
            // serializable tx so the receipt JE can post. Idempotent — a no-op
            // when rows already exist (the common post-#753 case). Gated on the
            // loop collection so a no-touch webhook skips the count query.
            if (touchedSnapshots.length > 0) {
              await ensureInstallmentSchedules(tx, contractForJe.id);
            }
            for (const snapshot of touchedSnapshots) {
              const instSchedPs = await tx.installmentSchedule.findUnique({
                where: {
                  contractId_installmentNo: {
                    contractId: contractForJe.id,
                    installmentNo: snapshot.installmentNo,
                  },
                },
                select: { id: true, vat60dayJournalEntryId: true },
              });
              if (instSchedPs) {
                await this.paymentReceiptTemplate.execute(
                  {
                    installmentScheduleId: instSchedPs.id,
                    delta: new Decimal(snapshot.payThis.toString()),
                    debitAccountCode: '11-1202',
                    lateFee: snapshot.lateFee.gt(0)
                      ? new Decimal(snapshot.lateFee.toString())
                      : undefined,
                    isFinalReceipt: snapshot.isFinalReceipt,
                    paymentId: snapshot.id,
                    // PR-843/I2 Phase 5b — the QR webhook always clears the FULL owed
                    // amount per installment (payThis = min(remaining, owed), never a
                    // deliberate customer underpayment), so any ≤1฿ residual on the
                    // last installment is a system amountDue↔installmentTotal rounding
                    // artifact → auto-approve the 52-1104 close (no approver on the
                    // webhook path).
                    autoApproveSystemRounding: true,
                  },
                  tx,
                );
                if (instSchedPs.vat60dayJournalEntryId) {
                  await this.vat60Reversal.execute(instSchedPs.id, tx);
                }
              } else {
                // Even after lazy-gen the row is absent — a genuine data
                // anomaly (totalMonths<=0, or installmentNo beyond the schedule).
                // Do NOT silently skip and do NOT roll back: the customer's
                // payment is real and already PAID; rolling back would discard
                // it. Alarm loudly so accounting posts the missing receipt JE.
                Sentry.captureException(
                  new Error(
                    'PAID installment has no postable 2B JE (no InstallmentSchedule after lazy-gen)',
                  ),
                  {
                    level: 'error',
                    tags: { module: 'paysolutions', flow: '2b-receipt' },
                    extra: {
                      contractId: contractForJe.id,
                      installmentNo: snapshot.installmentNo,
                      paymentId: snapshot.id,
                      refno,
                    },
                  },
                );
                this.logger.error(
                  `PaySolutions: PaymentReceipt2B UNPOSTABLE — no InstallmentSchedule for contractId=${contractForJe.id} installmentNo=${snapshot.installmentNo} (Sentry-alarmed; manual reconcile needed)`,
                );
              }
            }
          }

          // OWNER POLICY (PR-843/I2 #3): park PaySolutions over-collection as a customer
          // advance (Cr 21-1103) instead of dropping/alerting only. The surplus cash had
          // no Dr yet (the per-installment receipts only Dr'd their payThis), so this JE
          // both books the remaining cash and parks the advance.
          // Gate on contractForJe (mirrors the per-installment JE gate above): if the
          // contract row is missing we skip the JE + advanceBalance update rather than
          // throw and roll back the whole webhook (consistency w/ the receipt-JE block). (review)
          if (remaining.gt(0) && contractForJe) {
            await this.journalAutoService.createAndPost(
              {
                description: `เงินรับล่วงหน้า (รับเกินผ่าน Pay Solutions) — refno ${refno}`,
                reference: `${refno}-surplus`,
                metadata: {
                  tag: 'paysolutions-surplus-advance',
                  contractId: paymentLink.contractId,
                  refno,
                  surplus: remaining.toString(),
                },
                lines: [
                  {
                    accountCode: '11-1202',
                    dr: remaining,
                    cr: new Decimal(0),
                    description: 'เงินรับเกิน',
                  },
                  {
                    accountCode: '21-1103',
                    dr: new Decimal(0),
                    cr: remaining,
                    description: 'เงินรับล่วงหน้า',
                  },
                ],
              },
              tx,
            );
            await tx.contract.update({
              where: { id: paymentLink.contractId! },
              data: { advanceBalance: { increment: remaining } },
            });
            if (systemUserId) {
              await tx.auditLog.create({
                data: {
                  action: 'OVERPAY_ADVANCE_RECORDED',
                  entity: 'contract',
                  entityId: paymentLink.contractId!,
                  userId: systemUserId,
                  newValue: {
                    source: 'PAYSOLUTIONS_SURPLUS',
                    refno,
                    surplus: remaining.toString(),
                    paidAmount: paidAmount.toString(),
                  },
                },
              });
            }
            this.logger.log(
              `PaySolutions surplus ${remaining.toString()} parked as advance (21-1103) for contract ${paymentLink.contractId} refno=${refno}`,
            );
          }

          return {
            alreadyClaimed: false as const,
            contractStatus,
            fullyPaidCount,
            totalUnpaidAtStart: unpaidPayments.length,
            touchedSnapshots,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (result.alreadyClaimed) {
        this.logger.log(
          `Payment webhook refno=${refno}: link already claimed by prior retry — idempotent skip`,
        );
        return;
      }

      this.logger.log(
        `Payment SUCCESS: refno=${refno}, contractId=${paymentLink.contractId}, contractStatus=${result.contractStatus ?? 'ACTIVE'}, fullyPaid=${result.fullyPaidCount}/${result.totalUnpaidAtStart}`,
      );

      // C2 fix: the JE post that used to be HERE (outside the $transaction)
      // was moved inside the tx above so a JE failure rolls back the
      // Payment.update. Orphan PAID rows are now impossible — the previous
      // F-1-003 follow-up + webhook-je-failure Sentry path is removed.

      // Route notification: multi-installment close = early-payoff flex;
      // everything else uses the existing single-installment flex.
      if (result.contractStatus === 'EARLY_PAYOFF') {
        await this.host.sendEarlyPayoffSuccessNotification(
          paymentLink.contractId,
          paidAmount,
        );
      } else {
        await this.host.sendPaymentSuccessNotification(
          paymentLink.contractId,
          paymentLink.paymentId,
        );
      }
    } else {
      // ชำระไม่สำเร็จ
      if (paymentLink.paymentId) {
        await this.prisma.payment.update({
          where: { id: paymentLink.paymentId },
          data: {
            gatewayStatus: 'FAILED',
            gatewayResponse: webhookData as object,
          },
        });
      }

      // Expire the link so customer can retry
      await this.prisma.paymentLink.update({
        where: { id: paymentLink.id },
        data: { status: 'EXPIRED' },
      });

      this.logger.log(`Payment FAILED: refno=${refno}, result_code=${result_code}`);
    }
  }

  /**
   * ส่ง LINE flex message แจ้งลูกค้าว่าชำระสำเร็จ
   */
  async sendPaymentSuccessNotification(
    contractId: string,
    paymentId: string | null,
  ): Promise<void> {
    try {
      const contract = await this.prisma.contract.findUnique({
        where: { id: contractId },
        include: {
          customer: { select: { name: true, lineIdFinance: true } },
          payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
        },
      });

      if (!contract?.customer.lineIdFinance) return;

      const payment = paymentId
        ? contract.payments.find((p) => p.id === paymentId)
        : null;

      if (!payment) return;

      const paidCount = contract.payments.filter((p) => p.status === 'PAID').length;

      const flex = buildPaymentSuccessFlex({
        customerName: contract.customer.name,
        contractNumber: contract.contractNumber,
        installmentNo: payment.installmentNo,
        totalInstallments: contract.payments.length,
        amountPaid: Number(payment.amountPaid),
        paymentMethod: 'ONLINE_GATEWAY',
        paidDate: formatDateLong(new Date()),
        remainingInstallments: contract.payments.length - paidCount,
      });

      await this.lineOaService.sendFlexMessage(contract.customer.lineIdFinance, flex, 'line-finance');
      this.logger.log(`LINE notification sent for contract ${contract.contractNumber}`);
    } catch (err) {
      // ไม่ให้ notification error ทำให้ webhook fail
      this.logger.error(`Failed to send LINE notification: ${err}`);
    }
  }

  /**
   * ส่ง LINE flex message แจ้งลูกค้าว่าปิดยอดก่อนกำหนดสำเร็จ
   * Used when a single PaySolutions payment closed multiple installments
   * (via the 50%-discount LIFF early-payoff flow).
   */
  async sendEarlyPayoffSuccessNotification(
    contractId: string,
    paidAmount: Prisma.Decimal,
  ): Promise<void> {
    try {
      const contract = await this.prisma.contract.findUnique({
        where: { id: contractId },
        include: {
          customer: { select: { name: true, lineIdFinance: true } },
          payments: { where: { deletedAt: null } },
        },
      });
      if (!contract?.customer.lineIdFinance) return;

      // "Original amount" — what the customer would have paid without the
      // early-payoff discount (sum of all installment totals incl. lateFee).
      const originalAmount = contract.payments.reduce((acc, p) => {
        const lateFee = p.lateFeeWaived ? new Prisma.Decimal(0) : p.lateFee;
        return acc.add(p.amountDue).add(lateFee);
      }, new Prisma.Decimal(0));
      const savings = Prisma.Decimal.max(originalAmount.sub(paidAmount), new Prisma.Decimal(0));

      const flex = buildEarlyPayoffSuccessFlex({
        customerName: contract.customer.name,
        contractNumber: contract.contractNumber,
        amountPaid: Number(paidAmount),
        originalAmount: Number(originalAmount),
        savings: Number(savings),
        payoffDate: formatDateLong(new Date()),
      });

      await this.lineOaService.sendFlexMessage(contract.customer.lineIdFinance, flex, 'line-finance');
      this.logger.log(
        `Early-payoff notification sent for contract ${contract.contractNumber}`,
      );
    } catch (err) {
      this.logger.error(`Failed to send early-payoff notification: ${err}`);
    }
  }
}
