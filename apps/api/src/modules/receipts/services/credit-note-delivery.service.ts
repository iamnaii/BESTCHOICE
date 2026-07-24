import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { Prisma, LineChannelType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { toNum } from '../../../utils/decimal.util';
import { LineFinanceClientService } from '../../chatbot-finance/services/line-finance-client.service';
import {
  COLORS,
  GRADIENTS,
  createHeader,
  createDetailRow,
  createUriButton,
  wrapFlexMessage,
  FlexBubble,
  FlexMessagePayload,
} from '../../line-oa/flex-messages/base-template';

type ReceiptForDelivery = Prisma.ReceiptGetPayload<{
  include: {
    contract: {
      select: {
        contractNumber: true;
        customer: {
          select: {
            id: true;
            name: true;
            lineIdFinance: true;
            lineLinks: { select: { lineUserId: true } };
          };
        };
      };
    };
  };
}>;

/**
 * Phase 3 Task 5 — pushes an auto-issued ใบลดหนี้ (Credit Note, source
 * REPOSSESSION/WRITE_OFF) to the customer over LINE FINANCE, tracks the
 * attempt in NotificationLog, and falls back to a Todo when delivery is not
 * possible.
 *
 * Caller contract: `deliver()` is a POST-COMMIT hook. It must ONLY be invoked
 * AFTER the $transaction that created the Receipt row has resolved
 * (RepossessionsService.create / BadDebtService.writeOffBadDebt) — never from
 * inside that same $transaction. A rollback must never hand the customer a
 * LINE link to a receipt that turned out not to exist. Callers fire this
 * fire-and-forget: `void this.cnDelivery.deliver(receiptId).catch(Sentry.captureException)`.
 */
@Injectable()
export class CreditNoteDeliveryService {
  private readonly logger = new Logger(CreditNoteDeliveryService.name);
  private readonly baseUrl: string;

  constructor(
    private prisma: PrismaService,
    private lineFinanceClient: LineFinanceClientService,
    private configService: ConfigService,
  ) {
    // SAME source as PaymentLinkService (line-oa/payment-links/payment-link.service.ts)
    // — binding decision from the Phase 3 plan: do not introduce a second
    // "base URL" env var for customer-facing document links.
    this.baseUrl =
      this.configService.get<string>('PAYMENT_LINK_BASE_URL') ||
      this.configService.get<string>('FRONTEND_URL') ||
      'http://localhost:5173';
  }

  /**
   * Push the ใบลดหนี้ Flex card to the customer's LINE FINANCE account.
   *
   * PDPA (owner decision, 2026-07-24): sent WITHOUT gating on PDPA consent.
   * A ใบลดหนี้ is a tax document the seller is legally obligated to issue and
   * deliver (legitimate interest / legal obligation basis under PDPA) — it is
   * NOT a marketing message. This is deliberately different from
   * `LineFlexBuilderService.sendPaymentReceipt`
   * (line-oa/services/line-flex-builder.service.ts:115), which gates on
   * `pdpaService.hasActiveConsent()` because a regular payment-receipt flex
   * IS a discretionary customer-service message.
   *
   * Retry (owner decision, 2026-07-24): v1 ships with NO automatic retry.
   * A failed send writes a NotificationLog FAILED row + a Todo fallback (so a
   * human follows up — e.g. attaching the CN to the physical EMS termination
   * letter), which is sufficient for current volume. Natural follow-up if CN
   * volume grows: route through `NotificationDispatchService.send()` instead
   * of pushing directly — that queue already implements exponential-backoff
   * retry (5 attempts, 5min·3^n) for free. Deferred to keep this task's
   * blast radius small.
   *
   * NEVER throws — every failure path (receipt not found, no LINE link, push
   * exception, or a bookkeeping write failing) is caught internally so a
   * fire-and-forget caller never needs its own try/catch.
   */
  async deliver(receiptId: string): Promise<{ delivered: boolean }> {
    const receipt = await this.loadReceipt(receiptId);
    if (!receipt) {
      this.logger.warn(`[CN Delivery] receipt ${receiptId} not found or deleted — skipping`);
      return { delivered: false };
    }

    // Every deliver() call is a resend candidate (manual "ส่งซ้ำ" button or a
    // future retry) — always push the public-link TTL forward to now+30d so a
    // resend never hands the customer a dead link. Same token is kept (no
    // rotation) so any link already shared previously keeps working too.
    await this.refreshPublicTokenExpiry(receipt);

    const customer = receipt.contract?.customer;
    const lineUserId = customer?.lineLinks?.[0]?.lineUserId || customer?.lineIdFinance || null;

    if (!lineUserId) {
      await this.handleFailure(receipt, 'ลูกค้ายังไม่ผูก LINE การเงิน — ไม่พบ LINE user id', undefined, 'NO_LINE_LINK');
      return { delivered: false };
    }

    try {
      const flex = this.buildFlex(receipt);
      await this.lineFinanceClient.pushMessage(lineUserId, [flex as never]);
    } catch (err) {
      await this.handleFailure(
        receipt,
        err instanceof Error ? err.message : String(err),
        lineUserId,
      );
      return { delivered: false };
    }

    await this.handleSuccess(receipt, lineUserId);
    return { delivered: true };
  }

  private async loadReceipt(receiptId: string): Promise<ReceiptForDelivery | null> {
    try {
      const receipt = await this.prisma.receipt.findUnique({
        where: { id: receiptId },
        include: {
          contract: {
            select: {
              contractNumber: true,
              customer: {
                select: {
                  id: true,
                  name: true,
                  lineIdFinance: true,
                  lineLinks: {
                    where: { channel: LineChannelType.FINANCE, unlinkedAt: null, deletedAt: null },
                    select: { lineUserId: true },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      });
      if (!receipt || receipt.deletedAt) return null;
      return receipt;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`[CN Delivery] failed to load receipt ${receiptId}: ${reason}`);
      // Legally-mandated document delivery — ops must be alerted, not just logged.
      Sentry.captureMessage('CN delivery failed: receipt load error', {
        level: 'warning',
        tags: { subsystem: 'credit-note' },
        extra: { receiptId, reason },
      });
      return null;
    }
  }

  private buildFlex(receipt: ReceiptForDelivery): FlexMessagePayload {
    const amount = toNum(receipt.amount);
    const url = `${this.baseUrl}/cn/${receipt.publicToken}`;

    const bubble: FlexBubble = {
      type: 'bubble',
      size: 'mega',
      header: createHeader('📄 ใบลดหนี้', `เลขที่ ${receipt.receiptNumber}`, GRADIENTS.BLUE),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        spacing: 'sm',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: COLORS.INFO_LIGHT,
            cornerRadius: '12px',
            paddingAll: '16px',
            contents: [
              {
                type: 'text',
                text: `฿${amount.toLocaleString()}`,
                size: 'xxl',
                color: COLORS.INFO,
                weight: 'bold',
                align: 'center',
              },
              {
                type: 'text',
                text: 'ยอดลดหนี้รวม',
                size: 'xs',
                color: COLORS.MUTED,
                align: 'center',
                margin: 'sm',
              },
            ],
          },
          { type: 'separator', margin: 'lg', color: COLORS.BORDER },
          createDetailRow('เลขที่ใบลดหนี้', receipt.receiptNumber),
          createDetailRow('สัญญา', receipt.contract?.contractNumber ?? '-'),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '15px',
        contents: [createUriButton('ดูเอกสาร', url, COLORS.PRIMARY)],
      },
    };

    return wrapFlexMessage(
      `ใบลดหนี้ ${receipt.receiptNumber} ยอด ${amount.toLocaleString()} บาท`,
      bubble,
    );
  }

  /**
   * Always extends `publicTokenExpiresAt` to now+30d on every deliver/resend
   * (I1 fix). Mutates the in-memory `receipt` too so `buildFlex`/subsequent
   * logic in this same call sees the refreshed value. Never throws — a
   * failure here must not block the actual LINE push.
   */
  private async refreshPublicTokenExpiry(receipt: ReceiptForDelivery): Promise<void> {
    try {
      const publicTokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await this.prisma.receipt.update({
        where: { id: receipt.id },
        data: { publicTokenExpiresAt },
      });
      receipt.publicTokenExpiresAt = publicTokenExpiresAt;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[CN Delivery] failed to refresh publicTokenExpiresAt for receipt ${receipt.id}: ${reason}`,
      );
      Sentry.captureMessage('CN delivery: failed to refresh publicTokenExpiresAt', {
        level: 'warning',
        tags: { subsystem: 'credit-note' },
        extra: { receiptId: receipt.id, reason },
      });
    }
  }

  private async getSystemUserId(): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { isSystemUser: true },
      select: { id: true },
    });
    if (!user) throw new Error('SYSTEM user not found (isSystemUser=true)');
    return user.id;
  }

  /** FAILED path: NotificationLog FAILED + Todo fallback + AuditLog CN_SEND_FAILED. Never throws. */
  private async handleFailure(
    receipt: ReceiptForDelivery,
    errorMsg: string,
    recipient: string | undefined,
    blockReason?: string,
  ): Promise<void> {
    try {
      const customer = receipt.contract?.customer;
      await this.prisma.notificationLog.create({
        data: {
          channel: 'LINE',
          channelKey: 'line-finance',
          recipient: recipient ?? 'NO_LINE_LINK',
          message: `ใบลดหนี้ #${receipt.receiptNumber}`,
          status: 'FAILED',
          errorMsg,
          blockReason,
          relatedId: receipt.id,
          customerId: customer?.id,
          category: 'CREDIT_NOTE',
        },
      });

      const systemUserId = await this.getSystemUserId();
      const customerName = customer?.name ?? receipt.payerName;

      // M6: dedup — repeated failures for the same receipt (e.g. retried
      // resends that keep failing) must not spam a new Todo every time. Skip
      // creating a second one if an open (not DONE) todo already covers this
      // receipt; the NotificationLog FAILED row + audit log still get written
      // every attempt so the failure history isn't lost.
      const existingTodo = await this.prisma.todo.findFirst({
        where: {
          tags: { has: 'credit-note' },
          title: { contains: receipt.receiptNumber },
          status: { not: 'DONE' },
        },
        select: { id: true },
      });

      const todoId =
        existingTodo?.id ??
        (
          await this.prisma.todo.create({
            data: {
              title: `ส่งใบลดหนี้ ${receipt.receiptNumber} ให้ ${customerName} — LINE ไม่สำเร็จ (แนบซอง EMS กับหนังสือบอกเลิกได้)`,
              priority: 'MEDIUM',
              tags: ['credit-note'],
              createdById: systemUserId,
            },
          })
        ).id;

      await this.prisma.auditLog.create({
        data: {
          userId: systemUserId,
          action: 'CN_SEND_FAILED',
          entity: 'receipt',
          entityId: receipt.id,
          newValue: { receiptNumber: receipt.receiptNumber, errorMsg, todoId },
        },
      });

      this.logger.warn(`[CN Delivery] FAILED ${receipt.receiptNumber} — todo ${todoId} created`);
      // Legally-mandated document delivery — ops must be alerted, not just logged.
      Sentry.captureMessage(`CN delivery failed: ${errorMsg}`, {
        level: 'warning',
        tags: { subsystem: 'credit-note' },
        extra: { receiptId: receipt.id, reason: errorMsg },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[CN Delivery] failed to record failure fallback for receipt ${receipt.id}: ${reason}`,
      );
      Sentry.captureMessage('CN delivery failed: failure-fallback write error', {
        level: 'warning',
        tags: { subsystem: 'credit-note' },
        extra: { receiptId: receipt.id, reason },
      });
    }
  }

  /** Success path: NotificationLog SENT + AuditLog CN_SENT. Never throws. */
  private async handleSuccess(receipt: ReceiptForDelivery, lineUserId: string): Promise<void> {
    try {
      const customer = receipt.contract?.customer;
      await this.prisma.notificationLog.create({
        data: {
          channel: 'LINE',
          channelKey: 'line-finance',
          recipient: lineUserId,
          message: `ใบลดหนี้ #${receipt.receiptNumber}`,
          status: 'SENT',
          sentAt: new Date(),
          relatedId: receipt.id,
          customerId: customer?.id,
          category: 'CREDIT_NOTE',
        },
      });

      const systemUserId = await this.getSystemUserId();
      await this.prisma.auditLog.create({
        data: {
          userId: systemUserId,
          action: 'CN_SENT',
          entity: 'receipt',
          entityId: receipt.id,
          newValue: { receiptNumber: receipt.receiptNumber, lineUserId, channelKey: 'line-finance' },
        },
      });

      this.logger.log(`[CN Delivery] SENT ${receipt.receiptNumber} → ${lineUserId}`);
    } catch (err) {
      // Push already succeeded (the customer DID receive the message) — a
      // bookkeeping failure here must not be reported back as a delivery
      // failure, just logged loudly for ops to notice. M5: also raise Sentry
      // — a missing SENT log is a silent double-send risk (nothing stops a
      // human/cron from re-triggering delivery for a receipt whose NotificationLog
      // never recorded the first successful push).
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[CN Delivery] push succeeded but bookkeeping failed for receipt ${receipt.id}: ${reason}`,
      );
      Sentry.captureMessage('CN sent but SENT log failed', {
        level: 'warning',
        tags: { subsystem: 'credit-note' },
        extra: { receiptId: receipt.id },
      });
    }
  }
}
