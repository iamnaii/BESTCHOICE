import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Prisma, PaymentLinkPurpose, PaymentMethod } from '@prisma/client';
import type { PartialPaymentLink } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { FINANCE_LINE_RECIPIENT_SELECT, financeLineRecipient } from '../../line-oa/services/otp-verified-customer';
import { LineOaService } from '../../line-oa/line-oa.service';
import { buildPaymentSuccessFlex } from '../../line-oa/flex-messages/payment-success.flex';
import { buildEarlyPayoffSuccessFlex } from '../../line-oa/flex-messages/early-payoff-success.flex';
import { ProductsService } from '../../products/products.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { PaymentReceiptTemplate } from '../../journal/cpa-templates/payment-receipt.template';
import {
  ADVANCE_VAT_META,
  advanceVatOf,
  buildAdvanceVatParkLines,
} from '../../journal/advance-vat';
import {
  emitDeferredWarnings,
  warningsOf,
  type DeferredWarning,
} from '../../journal/deferred-warning';
import { Vat60dayReversalTemplate } from '../../journal/cpa-templates/vat-60day-reversal.template';
import { BadDebtService } from '../../accounting/bad-debt.service';
import type { ReceiptsService } from '../../receipts/receipts.service';
import { reportReceiptIssueFailure } from '../../receipts/services/receipt-issue-alert';
import { ADVANCE_SURPLUS_RECEIPT_TYPE } from '../../receipts/receipt-types.constants';
import { formatDateLong } from '../../../utils/thai-date.util';
import { ensureInstallmentSchedules } from '../../../utils/installment-schedule.util';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { PaySolutionsGatewayClient } from './paysolutions-gateway.client';
import {
  parsePayoffQuoteSnapshot,
  PAYOFF_ELIGIBLE_CONTRACT_STATUSES,
  type PaySolutionsPayoffPort,
  type PayoffQuoteSnapshot,
} from '../payoff-quote-snapshot';
import { GatewayPayoffMismatchError } from '../../contracts/early-payoff-gateway';
import { findPendingBankRefunds } from '../../refunds/pending-bank-refund';
import { isRetryablePrismaWriteError } from '../../../utils/transaction-retry.util';
import { d } from '../../../utils/decimal.util';

/**
 * บัญชีรับเงินของเงินที่เข้าทาง Pay Solutions (ลิงก์ชำระ / QR ในไลน์) — ขา Dr ของใบรับชำระงวด · รายการเงินส่วนเกิน · ปิดยอด JP4 (Task 41)
 * ค่าเดิมที่ webhook ใช้มาตลอด (11-1202 ธนาคาร SCB ตามผังบัญชี) — ไม่ใช่ค่าใหม่
 */
export const PAYSOLUTIONS_DEPOSIT_ACCOUNT = '11-1202';

/** Task 41 — เหตุที่เงินของแถวติดตามปิดยอดถูกลงแบบ FIFO แทน JP4 (tag `reason` ของ Sentry · ข้อความในงานแจ้ง) */
export type GatewayPayoffFallbackReason =
  | 'QUOTE_MISMATCH'
  | 'REFUND_PENDING'
  | 'CONTRACT_STATUS'
  | 'NO_QUOTE_SNAPSHOT'
  | 'UNAVAILABLE'
  | 'JP4_ERROR';

const FALLBACK_REASON_TEXT: Record<GatewayPayoffFallbackReason, string> = {
  QUOTE_MISMATCH:
    'ยอดที่ลูกค้าจ่ายไม่ตรงยอดปิด ณ เวลาที่เงินเข้า (เช่น ข้ามวันแล้วมีงวดถึงกำหนด ค่าปรับเพิ่ม หรือมีเงินเข้าทางอื่นระหว่างนั้น)',
  REFUND_PENDING:
    'สัญญามีคำขอคืนเงินที่อนุมัติแล้วแต่ยังไม่ได้บันทึกผลธนาคาร (คำตัดสินเจ้าของ #24 — ปิดยอดไม่ได้จนกว่าจะบันทึกผล)',
  CONTRACT_STATUS: 'สถานะสัญญาตอนเงินเข้าไม่ใช่สถานะที่ปิดยอดได้ (ACTIVE / OVERDUE / DEFAULT)',
  NO_QUOTE_SNAPSHOT:
    'รายการชำระนี้ไม่มียอดปิดที่ระบบคำนวณไว้ตอนสร้าง QR (สร้างก่อนระบบใหม่ หรือ QR ปิดยอดของพนักงาน)',
  UNAVAILABLE: 'ระบบลงรายการปิดยอดไม่พร้อมขณะเงินเข้า',
  JP4_ERROR: 'ลงรายการปิดยอดไม่สำเร็จ (รายละเอียดใน Sentry)',
};

/** Todo ของเงินปิดยอดที่ลงแบบ FIFO — requestKey ต่อแถวติดตาม (ส่งซ้ำ/เรียกซ้ำได้ใบเดียว) */
export const PAYOFF_FALLBACK_TODO_TAG = 'paysolutions-payoff-fallback';
export const payoffFallbackRequestKey = (paymentLinkId: string) =>
  `${PAYOFF_FALLBACK_TODO_TAG}:${paymentLinkId}`;

type GatewayPayoffDecision =
  | { outcome: 'POSTED'; postCommit: Array<() => Promise<void>>; totalPayoff: number; snapshot: PayoffQuoteSnapshot }
  | {
      outcome: 'FALLBACK';
      reason: GatewayPayoffFallbackReason;
      snapshot: PayoffQuoteSnapshot | null;
      /** ยอดปิด ณ เวลาที่เงินเข้า (ก่อน FIFO) — null = คำนวณไม่ได้ */
      liveTotalPayoff: number | null;
      errorMessage: string | null;
    };

const GATEWAY_PAYOFF_SAVEPOINT = 'paysolutions_gateway_payoff';
const GATEWAY_PAYOFF_DIAG_SAVEPOINT = 'paysolutions_gateway_payoff_diag';

/**
 * serialization failure / deadlock ของ Postgres ⇒ ทั้งธุรกรรมของ webhook ต้องล้ม (controller ตอบ 5xx → PaySolutions ส่งซ้ำ แล้วรอบใหม่ตัดสินใหม่
 * ทั้งหมด) — ถอยเป็น FIFO ในธุรกรรมที่ Postgres ตัดสินว่าจะ commit ไม่ได้อยู่แล้วไม่มีประโยชน์ · P2002 (unique) ไม่ใช่การแข่ง — ถอยเป็น FIFO
 */
function isSerializationFailure(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
  return isRetryablePrismaWriteError(error);
}

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
    paidAmount?: Prisma.Decimal,
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
 * JEs, one contract-level BadDebtService.reverseStageOnPayment call (ECL
 * follow-up to C1, 2026-07-30), surplus-advance JE + advanceBalance + audit)
 * lives here AS ONE ATOM — never split, never crossing a seam. The C2 fix
 * that moved JE posting INSIDE the tx is preserved verbatim.
 *
 * Task 41 (owner decision #43): a `PAYOFF` tracking row first tries a real early
 * payoff (JP4 via `ContractPaymentService.earlyPayoff` — `gatewayMatch` entry) inside
 * this SAME transaction, wrapped in a savepoint. Posted ⇒ no FIFO. Anything that blocks
 * JP4 rolls back to the savepoint and the FIFO below runs unchanged (+ HIGH todo and a
 * Sentry warning after commit). Serialization/deadlock still fails the whole webhook.
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
    private badDebtService: BadDebtService,
    private host: PaySolutionsWebhookHost,
    /**
     * ใบเสร็จของงวดที่เงินลิงก์ชำระจ่าย (PR3 — คำสั่งเจ้าของ 2026-09-30). ไม่ส่ง = ไม่ออกใบ (ค่าเริ่มต้นของ spec เดิม)
     */
    private receipts?: Pick<ReceiptsService, 'generateReceipt'>,
    /**
     * Task 41 (คำตัดสินเจ้าของ #43) — แกนปิดยอดก่อนกำหนด (`ContractPaymentService.earlyPayoff` ทางเข้า `gatewayMatch`) สำหรับแถวติดตาม
     * `PAYOFF` ที่เงินเข้าเท่ายอดปิด · ไม่ส่ง = ทุกเงินเข้า FIFO เดิม (แถว `PAYOFF` ได้งานแจ้งพนักงาน)
     */
    private payoff?: PaySolutionsPayoffPort,
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- pre-existing: query kept (SHOP leg wiring pending), value unused
      const shopCompanyId = shopCompany?.id ?? null;
      const contractForJe = await this.prisma.contract.findUnique({
        where: { id: paymentLink.contractId! },
        select: { id: true, contractNumber: true, branchId: true },
      });

      // Period-lock: the receipt JE posts to today's FINANCE period (postedAt=now).
      // Mirror PaymentsService.recordPayment so an autonomous webhook cannot post into a
      // CLOSED period past its grace window, or a SYNCED one. A posting dated "today" is never past
      // a CLOSED period's grace — it accepts through the end of its last day + grace (Bangkok, owner
      // rule 2026-10-31) — so for CLOSED this only bites a webhook that straddles midnight on the 1st.
      // A SYNCED period has no grace (owner decision #23, 2026-10-31): if today's month was already
      // sent to PEAK, this rejects money the gateway has captured — reconcile manually from Sentry.
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
      /** สัญญาณเตือนของใบรับชำระ (ตั้งลูกหนี้งวด ณ วันรับเงิน) — ส่งหลังธุรกรรม commit เท่านั้น */
      const receiptWarnings: DeferredWarning[] = [];
      const result = await this.prisma.$transaction(
        async (tx) => {
          const claim = await tx.paymentLink.updateMany({
            where: { id: paymentLink.id, status: 'ACTIVE' },
            data: { status: 'USED', usedAt: new Date() },
          });
          if (claim.count === 0) {
            return { alreadyClaimed: true as const };
          }
          // Task 39 (รีวิว 4ข) — แถวติดตามที่สร้างจากลิงก์ `/pay/:token` (PAYOFF / AMOUNT) ชี้ลิงก์ต้นทาง ⇒ เงินเข้าแล้วลิงก์ต้นทางเป็น USED
          // ในธุรกรรมเดียวกับการรับเงิน (กดจ่ายซ้ำไม่ได้ — create-intent ตอบ "ลิงก์นี้ชำระเงินแล้ว") · เฉพาะ webhook สำเร็จ · ส่งซ้ำจบที่ claim ข้างบน ·
          // `status: 'ACTIVE'` ⇒ ทำซ้ำไม่มีผล · ลิงก์งวดไม่มีลิงก์ต้นทาง (งวดที่ชำระแล้วกันการจ่ายซ้ำเองอยู่แล้ว)
          if (paymentLink.sourceLinkId) {
            await tx.paymentLink.updateMany({
              where: { id: paymentLink.sourceLinkId, status: 'ACTIVE' },
              data: { status: 'USED', usedAt: new Date() },
            });
          }

          // ตั้งลูกหนี้งวด ณ วันรับเงิน: สถานะของสัญญา "ก่อนรับเงิน" — อ่านในธุรกรรมนี้ หลังได้สิทธิ์ลิงก์
          // และก่อนแก้อะไร. การอ่านนอกธุรกรรม (contractForJe) ไม่เห็นการบอกเลิก/รับเครื่องคืนที่ commit
          // แทรกเข้ามาระหว่างนั้น
          const contractBeforeReceipt = await tx.contract.findUnique({
            where: { id: paymentLink.contractId! },
            select: { status: true },
          });

          // Task 41 (คำตัดสินเจ้าของ #43) — แถวติดตาม intent ปิดยอด (`PAYOFF`): เงินเท่ายอดปิด ณ เวลาที่เงินเข้า (±0.01) = ปิดยอดก่อนกำหนด
          // จริง (JP4 — แกนเดียวกับพนักงานทางสลิปตรง) ในธุรกรรมนี้ แทนการกระจายเงินทีละงวด · ลง JP4 ไม่ได้ด้วยเหตุใดก็ตาม (ยอดไม่ตรง ·
          // คำขอคืนเงินรอธนาคาร #24 · สถานะสัญญา · ไม่มี snapshot · error) = ถอยกลับ savepoint แล้ว FIFO ข้างล่างตามเดิมทุกตัวอักษร +
          // งานแจ้ง HIGH + Sentry warning หลัง commit — webhook ห้ามทิ้งเงินที่ตัดแล้ว
          let payoffFallback: Extract<GatewayPayoffDecision, { outcome: 'FALLBACK' }> | null = null;
          if (paymentLink.purpose === PaymentLinkPurpose.PAYOFF) {
            const decision = await this.settleGatewayPayoff(tx, {
              paymentLinkId: paymentLink.id,
              contractId: paymentLink.contractId!,
              payoffQuote: paymentLink.payoffQuote,
              paidAmount,
              refno,
              transactionId: transaction_id || null,
              webhookData,
              systemUserId,
              paidAt: new Date(),
            });
            if (decision.outcome === 'POSTED') {
              return { alreadyClaimed: false as const, kind: 'GATEWAY_PAYOFF' as const, decision };
            }
            payoffFallback = decision;
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
            /** เลขที่รายการรับชำระของงวดนี้ — ใบเสร็จผูกรายการนี้หลัง commit (PR3) */
            entryNo?: string;
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
                const posted = await this.paymentReceiptTemplate.execute(
                  {
                    installmentScheduleId: instSchedPs.id,
                    delta: new Decimal(snapshot.payThis.toString()),
                    debitAccountCode: PAYSOLUTIONS_DEPOSIT_ACCOUNT,
                    lateFee: snapshot.lateFee.gt(0)
                      ? new Decimal(snapshot.lateFee.toString())
                      : undefined,
                    isFinalReceipt: snapshot.isFinalReceipt,
                    paymentId: snapshot.id,
                    // ตั้งลูกหนี้งวด ณ วันรับเงิน: สถานะที่อ่านไว้ก่อนธุรกรรมนี้เปลี่ยนเป็น
                    // EARLY_PAYOFF / COMPLETED
                    contractStatusBeforeReceipt: contractBeforeReceipt?.status,
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
                receiptWarnings.push(...warningsOf(posted));
                snapshot.entryNo = posted?.entryNo;
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

            // CPA Policy A §3.6 — ECL stage reverse on payment (follow-up to
            // C1/PR #1384, owner decision 2026-07-30). The cashier recordPayment
            // path (payment-receipt-orchestrator.ts) already calls this after
            // every receipt; this webhook was the only production caller of
            // paymentReceiptTemplate that skipped it — a QR payment closing a
            // contract (EARLY_PAYOFF/COMPLETED above) left the contract's 11-2102
            // allowance stuck forever once it exits the daily cron's scope
            // (ACTIVE/OVERDUE/DEFAULT/TERMINATED only), same failure class as C1.
            //
            // Called ONCE per contract per webhook (not per installment) — the
            // FIFO loop above may have touched several installments in one
            // webhook (e.g. an early-payoff QR closing >1 installment);
            // reverseStageOnPayment recomputes the contract's AGGREGATE target
            // from every remaining outstanding installment, so firing it once
            // after the last touched snapshot already reflects the full effect
            // of this webhook. When nothing remains outstanding it falls through
            // to the shared full-release path (Dr 11-2102 / Cr 51-1103 + row
            // REVERSED) — the same release primitive C1 uses for JP4 payoff,
            // just reached through the real-time hook instead of a bespoke
            // helper. Same try/catch shape as the orchestrator: Sentry-capture
            // then rethrow, so a reverse-JE failure rolls back this whole
            // webhook tx exactly like a receipt-JE failure does above (the
            // existing 'JE failure inside tx rolls back' test in
            // paysolutions.service.spec.ts pins that atomicity contract).
            if (touchedSnapshots.length > 0) {
              try {
                await this.badDebtService.reverseStageOnPayment(contractForJe.id, tx);
              } catch (err) {
                Sentry.captureException(err, {
                  extra: { contractId: contractForJe.id, refno },
                });
                throw err;
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
          // PR4ข: ใบรับเงินส่วนเกิน (ADVANCE_SURPLUS) ออกหลัง commit ผูกรายการนี้ — เลขที่รายการ + ยอดส่งออกจาก tx
          let surplusEntryNo: string | null = null;
          let surplusAmount: Prisma.Decimal | null = null;
          if (remaining.gt(0) && contractForJe) {
            // PR4 (ต2 ค): เงินเกินที่พักเป็นเงินรับล่วงหน้า ⇒ รับรู้ภาษีขาย ณ วันรับ ในรายการเดียวกัน
            const surplusVat = advanceVatOf(remaining);
            // PR4ข: บริบทให้ใบรับเงินส่วนเกินพิมพ์ "ยอดโอน · เข้างวด · งวดที่เงินไปถึง · งวดถัดไปที่จะหัก"
            // (ReceiptQueryService.surplusContext อ่านจาก metadata ของรายการนี้) — ส่วนเกินเกิดเมื่อเงินครอบ
            // ทุกงวดค้างแล้ว จึงมักไม่มีงวดถัดไป (null) — แถวที่ยังไม่ PAID หลังจัดสรร (เช่น owed ≤ 0) ถือเป็นงวดถัดไป
            const fullyPaidIds = new Set(
              touchedSnapshots.filter((s) => s.isFinalReceipt).map((s) => s.id),
            );
            const nextInstallmentNo =
              unpaidPayments.find((p) => !fullyPaidIds.has(p.id))?.installmentNo ?? null;
            const surplusJe = await this.journalAutoService.createAndPost(
              {
                description: `เงินรับล่วงหน้า (รับเกินผ่าน Pay Solutions) — refno ${refno}`,
                reference: `${refno}-surplus`,
                metadata: {
                  tag: 'paysolutions-surplus-advance',
                  contractId: paymentLink.contractId,
                  refno,
                  surplus: remaining.toString(),
                  ...(surplusVat.gt(0) ? { [ADVANCE_VAT_META.park]: surplusVat.toFixed(2) } : {}),
                  paidAmount: paidAmount.toString(),
                  appliedAmount: paidAmount.sub(remaining).toString(),
                  installmentNos: touchedSnapshots.map((s) => s.installmentNo),
                  nextInstallmentNo,
                },
                lines: [
                  {
                    accountCode: PAYSOLUTIONS_DEPOSIT_ACCOUNT,
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
                  ...buildAdvanceVatParkLines(surplusVat),
                ],
              },
              tx,
            );
            surplusEntryNo = surplusJe?.entryNumber ?? null;
            surplusAmount = remaining;
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
            kind: 'FIFO' as const,
            payoffFallback,
            contractStatus,
            fullyPaidCount,
            totalUnpaidAtStart: unpaidPayments.length,
            touchedSnapshots,
            paidAt: now,
            surplusEntryNo,
            surplusAmount,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      emitDeferredWarnings(receiptWarnings);

      if (result.alreadyClaimed) {
        this.logger.log(
          `Payment webhook refno=${refno}: link already claimed by prior retry — idempotent skip`,
        );
        return;
      }

      // Task 41 — ปิดยอดผ่าน QR ลง JP4 แล้ว: งานหลัง commit ของการปิดยอด (สัญญาณเตือน · ใบ EARLY_PAYOFF ผูก JP4 · journey) แล้วการ์ด
      // "ปิดยอดก่อนกำหนดสำเร็จ" เดิมทาง OA การเงิน (แม่แบบเดิม — ทางที่ FIFO ปิดหลายงวดเคยส่ง) · ไม่มีใบรับชำระงวด/เงินส่วนเกิน ·
      // ไม่มีการปลดล็อกเครื่อง (ห้ามแตะการเชื่อม MDM)
      if (result.kind === 'GATEWAY_PAYOFF') {
        await this.finishGatewayPayoff(result.decision, {
          contractId: paymentLink.contractId,
          contractNumber: contractForJe?.contractNumber ?? null,
          paymentLinkId: paymentLink.id,
          paidAmount,
          refno,
          transactionId: transaction_id || null,
        });
        return;
      }

      this.logger.log(
        `Payment SUCCESS: refno=${refno}, contractId=${paymentLink.contractId}, contractStatus=${result.contractStatus ?? 'ACTIVE'}, fullyPaid=${result.fullyPaidCount}/${result.totalUnpaidAtStart}`,
      );

      // Task 41 — เงินของแถวติดตามปิดยอดที่ลงแบบ FIFO: งาน HIGH ให้พนักงานปิดยอดต่อ + Sentry warning (หลัง commit · ไม่ throw)
      if (result.payoffFallback) {
        await this.alertPayoffFallback(result.payoffFallback, {
          contractId: paymentLink.contractId,
          contractNumber: contractForJe?.contractNumber ?? null,
          branchId: contractForJe?.branchId ?? null,
          paymentLinkId: paymentLink.id,
          paidAmount,
          refno,
          transactionId: transaction_id || null,
          systemUserId,
          contractStatusAfter: result.contractStatus,
        });
      }

      // ใบเสร็จของทุกงวดที่เงินนี้จ่าย (PR3 — คำสั่งเจ้าของ 2026-09-30: เดิมทางนี้ลงบัญชีแต่ไม่มีใบเสร็จ) — ออกหลัง
      // ธุรกรรม commit ผูกรายการรับชำระของงวดนั้น (VAT ของใบ = ภาษีขายของ 2A ที่ลงพร้อมกัน). webhook ที่ส่งซ้ำจบที่ด่าน
      // ลิงก์ USED / alreadyClaimed ข้างบนก่อนถึงตรงนี้ และ generateReceipt คืนใบเดิมถ้ารายการนี้มีใบแล้ว.
      // ใบใดออกไม่สำเร็จห้ามทำให้ webhook ล้ม (เงินเข้าและลงบัญชีแล้ว) — แจ้ง Sentry พร้อมเลขที่รายการสำหรับออกใบซ้ำ
      // (ผู้ให้บริการส่งซ้ำก็ไม่ถึงตรงนี้อีก). เรียกแบบเดียวกับหน้ารับชำระ → ข้อความใบเสร็จทาง LINE ตามกติกาเดิมต่องวด
      // (OA ของ SHOP) นอกเหนือจากข้อความ "ชำระสำเร็จ" ข้างล่าง (OA ของ FINANCE) — คำตอบเจ้าของ ถ4 2026-09-30
      if (this.receipts && contractForJe && systemUserId) {
        for (const snapshot of result.touchedSnapshots) {
          if (!snapshot.payThis.gt(0)) continue;
          try {
            await this.receipts.generateReceipt(
              paymentLink.contractId,
              snapshot.id,
              'INSTALLMENT',
              snapshot.payThis.toNumber(),
              snapshot.installmentNo,
              PaymentMethod.ONLINE_GATEWAY,
              transaction_id || refno,
              systemUserId,
              result.paidAt,
              snapshot.entryNo,
            );
          } catch (err) {
            this.logger.error(
              `Failed to generate receipt for payment ${snapshot.id} (refno=${refno}): ${err instanceof Error ? err.message : err}`,
            );
            reportReceiptIssueFailure(err, {
              path: 'paysolutions-webhook',
              contractId: paymentLink.contractId,
              paymentId: snapshot.id,
              installmentNo: snapshot.installmentNo,
              journalEntryNumber: snapshot.entryNo ?? null,
              paymentMethod: PaymentMethod.ONLINE_GATEWAY,
              amount: snapshot.payThis.toFixed(2),
              transactionRef: transaction_id || refno,
              issuedById: systemUserId,
              paidDate: result.paidAt.toISOString(),
            });
          }
        }
        // PR4ข (ฝ่ายบัญชี 16/10/2569 ข้อ 23.2): เงินส่วนเกินที่พักเป็นเงินรับล่วงหน้าได้ใบกำกับภาษีใบแยก
        // (ADVANCE_SURPLUS) ผูกรายการส่วนเกิน — ออกหลังใบงวดทุกใบ (ลำดับเลขที่ใบ: งวดก่อน ส่วนเกินทีหลัง)
        // ใบไม่ผูกแถว Payment / งวด (paymentId + installmentNo = null) · ออกไม่สำเร็จ = Sentry path ของตัวเอง
        if (result.surplusAmount && result.surplusAmount.gt(0)) {
          try {
            await this.receipts.generateReceipt(
              paymentLink.contractId,
              null,
              ADVANCE_SURPLUS_RECEIPT_TYPE,
              result.surplusAmount.toNumber(),
              null,
              PaymentMethod.ONLINE_GATEWAY,
              transaction_id || refno,
              systemUserId,
              result.paidAt,
              result.surplusEntryNo ?? undefined,
            );
          } catch (err) {
            this.logger.error(
              `Failed to generate ADVANCE_SURPLUS receipt for contract ${paymentLink.contractId} (refno=${refno}): ${err instanceof Error ? err.message : err}`,
            );
            reportReceiptIssueFailure(err, {
              path: 'paysolutions-webhook-surplus',
              contractId: paymentLink.contractId,
              paymentId: null,
              installmentNo: null,
              journalEntryNumber: result.surplusEntryNo,
              paymentMethod: PaymentMethod.ONLINE_GATEWAY,
              amount: result.surplusAmount.toFixed(2),
              transactionRef: transaction_id || refno,
              issuedById: systemUserId,
              paidDate: result.paidAt.toISOString(),
            });
          }
        }
      }

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
      } else if (paymentLink.paymentId) {
        await this.host.sendPaymentSuccessNotification(
          paymentLink.contractId,
          paymentLink.paymentId,
        );
      } else {
        // Task 39 (รีวิว I-2) — แถวติดตามที่ไม่มีงวด (ลิงก์ PAYOFF / AMOUNT · LiffEarlyPayoff) เดิมจบเงียบ ("ไม่มีงวด" ใน
        // sendPaymentSuccessNotification) ⇒ ใช้การ์ดเดียวกับลิงก์งวด: งวดสุดท้ายที่เงินไปถึง + ยอดที่ลูกค้าโอนจริง
        const lastTouched = result.touchedSnapshots[result.touchedSnapshots.length - 1];
        await this.host.sendPaymentSuccessNotification(
          paymentLink.contractId,
          lastTouched?.id ?? null,
          paidAmount,
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
   * Task 41 — ลงเงินของแถวติดตามปิดยอดเป็นปิดยอดก่อนกำหนด (JP4) ผ่าน `ContractPaymentService.earlyPayoff` ทางเข้า `gatewayMatch` ในธุรกรรมของ
   * webhook ภายใน savepoint · ล้ม (ยกเว้น serialization/deadlock ที่ต้องล้มทั้งก้อน) = กลับ savepoint แล้วคืน FALLBACK พร้อมเหตุผล ให้ FIFO
   * เดิมทำงานต่อในธุรกรรมเดียวกัน (ไม่มีแถวของ JP4 ค้าง — ทุกอย่างหลัง savepoint ถูกถอย)
   */
  private async settleGatewayPayoff(
    tx: Prisma.TransactionClient,
    ctx: {
      paymentLinkId: string;
      contractId: string;
      payoffQuote: Prisma.JsonValue | null;
      paidAmount: Prisma.Decimal;
      refno: string;
      transactionId: string | null;
      webhookData: Record<string, string>;
      systemUserId: string | null;
      paidAt: Date;
    },
  ): Promise<GatewayPayoffDecision> {
    const snapshot = parsePayoffQuoteSnapshot(ctx.payoffQuote);
    if (!snapshot) {
      return {
        outcome: 'FALLBACK',
        reason: 'NO_QUOTE_SNAPSHOT',
        snapshot: null,
        liveTotalPayoff: (await this.diagnoseGatewayPayoff(tx, ctx.contractId, undefined)).liveTotalPayoff,
        errorMessage: null,
      };
    }
    if (!this.payoff || !ctx.systemUserId) {
      return { outcome: 'FALLBACK', reason: 'UNAVAILABLE', snapshot, liveTotalPayoff: null, errorMessage: null };
    }

    const postCommit: Array<() => Promise<void>> = [];
    await tx.$executeRawUnsafe(`SAVEPOINT ${GATEWAY_PAYOFF_SAVEPOINT}`);
    try {
      const posted = await this.payoff.earlyPayoff(
        ctx.contractId,
        ctx.systemUserId,
        {
          paymentMethod: PaymentMethod.ONLINE_GATEWAY,
          // % ส่วนลดเดียวกับยอดที่ลูกค้าเห็นตอนสร้าง QR — ยอดปิดคำนวณใหม่ ณ เวลาที่เงินเข้าในธุรกรรมนี้
          discountPct: snapshot.discountPct,
          depositAccountCode: PAYSOLUTIONS_DEPOSIT_ACCOUNT,
          paymentDate: ctx.paidAt.toISOString(),
          referenceNo: ctx.transactionId || ctx.refno,
          notes: `ชำระผ่าน Pay Solutions (${ctx.transactionId || ctx.refno})`,
        },
        undefined,
        undefined,
        {
          tx,
          paidAmount: ctx.paidAmount,
          refno: ctx.refno,
          transactionId: ctx.transactionId,
          paymentLinkId: ctx.paymentLinkId,
          quoteSnapshot: snapshot,
          webhookData: ctx.webhookData,
          onCommit: (work) => postCommit.push(work),
        },
      );
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${GATEWAY_PAYOFF_SAVEPOINT}`);
      return { outcome: 'POSTED', postCommit, totalPayoff: posted.totalPayoff, snapshot };
    } catch (err) {
      if (isSerializationFailure(err)) throw err;
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${GATEWAY_PAYOFF_SAVEPOINT}`);
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (err instanceof GatewayPayoffMismatchError) {
        return {
          outcome: 'FALLBACK',
          reason: 'QUOTE_MISMATCH',
          snapshot,
          liveTotalPayoff: err.liveTotalPayoff,
          errorMessage,
        };
      }
      const diagnosis = await this.diagnoseGatewayPayoff(tx, ctx.contractId, snapshot.discountPct);
      return { outcome: 'FALLBACK', ...diagnosis, snapshot, errorMessage };
    }
  }

  /**
   * เหตุที่ลง JP4 ไม่ได้ (อ่านสถานะหลังถอย savepoint — ไม่ตีความข้อความ error) + ยอดปิด ณ เวลาที่เงินเข้าสำหรับงานแจ้ง · อ่านอย่างเดียวใน
   * savepoint ของตัวเอง: คำสั่งที่ล้มต้องไม่ทำให้ธุรกรรมของ FIFO ที่ตามมาเสีย
   */
  private async diagnoseGatewayPayoff(
    tx: Prisma.TransactionClient,
    contractId: string,
    discountPct: number | undefined,
  ): Promise<{ reason: GatewayPayoffFallbackReason; liveTotalPayoff: number | null }> {
    await tx.$executeRawUnsafe(`SAVEPOINT ${GATEWAY_PAYOFF_DIAG_SAVEPOINT}`);
    try {
      const contract = await tx.contract.findUnique({ where: { id: contractId }, select: { status: true } });
      let reason: GatewayPayoffFallbackReason = 'JP4_ERROR';
      if (!contract || !PAYOFF_ELIGIBLE_CONTRACT_STATUSES.includes(contract.status)) {
        reason = 'CONTRACT_STATUS';
      } else if ((await findPendingBankRefunds(tx, contractId)).length > 0) {
        reason = 'REFUND_PENDING';
      }
      let liveTotalPayoff: number | null = null;
      if (this.payoff && reason !== 'CONTRACT_STATUS') {
        try {
          liveTotalPayoff = (
            await this.payoff.getEarlyPayoffQuote(contractId, discountPct, undefined, tx, { skipJournalPreview: true })
          ).totalPayoff;
        } catch {
          liveTotalPayoff = null; // ด่านของ quote (ไม่มีงวดค้าง ฯลฯ) — JS error ไม่ทำให้ธุรกรรมเสีย
        }
      }
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${GATEWAY_PAYOFF_DIAG_SAVEPOINT}`);
      return { reason, liveTotalPayoff };
    } catch {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${GATEWAY_PAYOFF_DIAG_SAVEPOINT}`);
      return { reason: 'JP4_ERROR', liveTotalPayoff: null };
    }
  }

  /** งานหลัง commit ของการปิดยอดผ่าน QR — ห้าม throw (เงินและรายการบัญชี commit แล้ว) */
  private async finishGatewayPayoff(
    decision: Extract<GatewayPayoffDecision, { outcome: 'POSTED' }>,
    ctx: {
      contractId: string;
      contractNumber: string | null;
      paymentLinkId: string;
      paidAmount: Prisma.Decimal;
      refno: string;
      transactionId: string | null;
    },
  ): Promise<void> {
    for (const work of decision.postCommit) {
      try {
        await work();
      } catch (err) {
        this.logger.error(
          `Gateway payoff post-commit step failed for contract ${ctx.contractId} (refno=${ctx.refno}): ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    // เงินที่รับต่างยอดปิดในรายการได้ไม่เกิน 0.01 (กติกาเดียวกับสลิปตรง — รายการใช้ยอดปิด) · ต่างจริง = เงินในธนาคารต่างรายการ 1 สตางค์
    if (!d(decision.totalPayoff).eq(ctx.paidAmount)) {
      emitDeferredWarnings([
        {
          message: '[paysolutions payoff] money received differs from the posted payoff by up to 0.01 — JP4 books the payoff amount',
          tags: { module: 'paysolutions', action: 'paysolutions-payoff-satang-difference' },
          extra: {
            contractId: ctx.contractId,
            contractNumber: ctx.contractNumber,
            paymentLinkId: ctx.paymentLinkId,
            refno: ctx.refno,
            transactionId: ctx.transactionId,
            paidAmount: ctx.paidAmount.toFixed(2),
            totalPayoff: d(decision.totalPayoff).toFixed(2),
          },
        },
      ]);
    }
    this.logger.log(
      `Payment SUCCESS (early payoff JP4): refno=${ctx.refno}, contractId=${ctx.contractId}, paid=${ctx.paidAmount.toFixed(2)}`,
    );
    await this.host.sendEarlyPayoffSuccessNotification(ctx.contractId, ctx.paidAmount);
  }

  /**
   * Task 41 — เงินของแถวติดตามปิดยอดลงแบบ FIFO (ลง JP4 ไม่ได้): งาน HIGH หนึ่งใบต่อแถวติดตาม (`requestKey`) ให้พนักงานปิดยอดต่อ + Sentry warning ·
   * หลัง commit เท่านั้น · ไม่มีข้อมูลลูกค้าในข้อความ (เลขสัญญา/ยอด/เลขอ้างอิงเท่านั้น) · ห้าม throw
   */
  private async alertPayoffFallback(
    decision: Extract<GatewayPayoffDecision, { outcome: 'FALLBACK' }>,
    ctx: {
      contractId: string;
      contractNumber: string | null;
      branchId: string | null;
      paymentLinkId: string;
      paidAmount: Prisma.Decimal;
      refno: string;
      transactionId: string | null;
      systemUserId: string | null;
      contractStatusAfter: string | null;
    },
  ): Promise<void> {
    const fmt = (v: Prisma.Decimal.Value) =>
      Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const contractLabel = ctx.contractNumber ?? ctx.contractId;
    const reference = ctx.transactionId || ctx.refno;
    const nextStep = ctx.contractStatusAfter
      ? 'สัญญาปิดจากเงินก้อนนี้แล้วแบบรับชำระค่างวด (ไม่ใช่ปิดยอดก่อนกำหนด — ไม่มีส่วนลด) — แจ้งฝ่ายบัญชีตรวจรายการกับลูกค้า'
      : decision.reason === 'REFUND_PENDING'
        ? 'บันทึกผลธนาคารของคำขอคืนเงินก่อน (ยังไม่มีปุ่มในหน้าจอ — แจ้งฝ่ายบัญชีให้ทีมระบบบันทึก) แล้วเปิดหน้าสัญญา กดปุ่ม "ปิดก่อนกำหนด" เพื่อดูยอดคงเหลือหลังเงินก้อนนี้ แล้วปิดยอดตามขั้นตอนปกติหลังตรวจกับลูกค้า'
        : decision.reason === 'CONTRACT_STATUS'
          ? 'สัญญาไม่อยู่ในสถานะที่ปิดยอดได้ — แจ้งฝ่ายบัญชีตรวจเงินก้อนนี้กับสถานะสัญญา'
          : 'เปิดหน้าสัญญา กดปุ่ม "ปิดก่อนกำหนด" เพื่อดูยอดคงเหลือหลังเงินก้อนนี้ แล้วปิดยอดตามขั้นตอนปกติหลังตรวจกับลูกค้า';
    const description = [
      `ลูกค้าชำระผ่าน Pay Solutions ${fmt(ctx.paidAmount.toString())} บาท (อ้างอิง ${reference}) เพื่อปิดยอดก่อนกำหนด แต่ระบบลงเป็นปิดยอดไม่ได้: ${FALLBACK_REASON_TEXT[decision.reason]}`,
      `ยอดปิดตอนสร้าง QR: ${decision.snapshot ? `${fmt(decision.snapshot.totalPayoff)} บาท (วันที่ ${decision.snapshot.quoteDate})` : '—'} · ยอดปิด ณ เวลาที่เงินเข้า: ${decision.liveTotalPayoff != null ? `${fmt(decision.liveTotalPayoff)} บาท` : '—'}`,
      ctx.contractStatusAfter
        ? `ระบบลงเงินก้อนนี้เป็นค่างวดตามลำดับงวดแล้ว (ใบเสร็จค่างวดออกตามปกติ) — สถานะสัญญาหลังรับเงิน ${ctx.contractStatusAfter}`
        : 'ระบบลงเงินก้อนนี้เป็นค่างวดตามลำดับงวดแล้ว (ใบเสร็จค่างวดออกตามปกติ) — สัญญายังไม่ปิด',
      nextStep,
    ].join('\n');

    if (ctx.systemUserId) {
      try {
        const requestKey = payoffFallbackRequestKey(ctx.paymentLinkId);
        await this.prisma.todo.upsert({
          where: { requestKey },
          update: {},
          create: {
            requestKey,
            title: `ปิดยอดผ่าน QR ไม่สำเร็จ — สัญญา ${contractLabel} รับเงิน ${fmt(ctx.paidAmount.toString())} บาท`,
            description,
            priority: 'HIGH',
            tags: [PAYOFF_FALLBACK_TODO_TAG],
            createdById: ctx.systemUserId,
            branchId: ctx.branchId,
          },
        });
      } catch (err) {
        // งานแจ้งพังต้องไม่ทำให้ webhook ล้ม (เงินลงบัญชีแล้ว) — Sentry ด้านล่างยังมีข้อมูลครบ
        Sentry.captureException(err, {
          level: 'error',
          tags: { module: 'paysolutions', action: 'paysolutions-payoff-fallback-todo' },
          extra: { contractId: ctx.contractId, paymentLinkId: ctx.paymentLinkId, refno: ctx.refno },
        });
      }
    }
    emitDeferredWarnings([
      {
        message: `[paysolutions payoff] payoff payment booked FIFO instead of JP4 — ${decision.reason}`,
        tags: { module: 'paysolutions', action: 'paysolutions-payoff-fallback', reason: decision.reason },
        extra: {
          contractId: ctx.contractId,
          contractNumber: ctx.contractNumber,
          paymentLinkId: ctx.paymentLinkId,
          refno: ctx.refno,
          transactionId: ctx.transactionId,
          paidAmount: ctx.paidAmount.toFixed(2),
          liveTotalPayoff: decision.liveTotalPayoff != null ? d(decision.liveTotalPayoff).toFixed(2) : null,
          quotedTotalPayoff: decision.snapshot?.totalPayoff ?? null,
          quoteDate: decision.snapshot?.quoteDate ?? null,
          contractStatusAfter: ctx.contractStatusAfter,
          error: decision.errorMessage,
        },
      },
    ]);
  }

  /**
   * ส่ง LINE flex message แจ้งลูกค้าว่าชำระสำเร็จ
   */
  async sendPaymentSuccessNotification(
    contractId: string,
    paymentId: string | null,
    /** Task 39 — ยอดที่ลูกค้าโอนจริง (ลิงก์ที่ไม่ใช่ลิงก์งวด — เงินอาจครอบหลายงวด) · ไม่ส่ง = ยอดสะสมของงวดแบบเดิม */
    paidAmount?: Prisma.Decimal,
  ): Promise<void> {
    try {
      const contract = await this.prisma.contract.findUnique({
        where: { id: contractId },
        include: {
          customer: { select: { name: true, ...FINANCE_LINE_RECIPIENT_SELECT } },
          payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
        },
      });

      // ปลายทาง LINE การเงิน = แถว OTP ของลูกค้า (Task 22 I-1 ง) ไม่ใช่คอลัมน์ line_id_finance ที่อาจค้าง
      const financeLineId = financeLineRecipient(contract?.customer);
      if (!contract || !financeLineId) return;

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
        amountPaid: Number(paidAmount ?? payment.amountPaid),
        paymentMethod: 'ONLINE_GATEWAY',
        paidDate: formatDateLong(new Date()),
        remainingInstallments: contract.payments.length - paidCount,
      });

      await this.lineOaService.sendFlexMessage(financeLineId, flex, 'line-finance');
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
          customer: { select: { name: true, ...FINANCE_LINE_RECIPIENT_SELECT } },
          payments: { where: { deletedAt: null } },
        },
      });
      // ปลายทาง LINE การเงิน = แถว OTP ของลูกค้า (Task 22 I-1 ง) ไม่ใช่คอลัมน์ line_id_finance ที่อาจค้าง
      const financeLineId = financeLineRecipient(contract?.customer);
      if (!contract || !financeLineId) return;

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

      await this.lineOaService.sendFlexMessage(financeLineId, flex, 'line-finance');
      this.logger.log(
        `Early-payoff notification sent for contract ${contract.contractNumber}`,
      );
    } catch (err) {
      this.logger.error(`Failed to send early-payoff notification: ${err}`);
    }
  }
}
