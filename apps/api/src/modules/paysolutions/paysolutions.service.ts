import {
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import { OnlineOrderSaleAdapter } from '../shop-orders/online-order-sale.adapter';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { ProductsService } from '../products/products.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { PaymentReceiptTemplate } from '../journal/cpa-templates/payment-receipt.template';
import { Vat60dayReversalTemplate } from '../journal/cpa-templates/vat-60day-reversal.template';
import { PaymentsService } from '../payments/payments.service';
import type { PartialPaymentLink } from '@prisma/client';
import { PaySolutionsGatewayClient } from './services/paysolutions-gateway.client';
import {
  PaySolutionsIntentService,
  PaymentIntentResult,
} from './services/paysolutions-intent.service';
import {
  PaySolutionsConfirmationService,
  PaymentStatusResult,
} from './services/paysolutions-confirmation.service';
import { PaySolutionsWebhookService } from './services/paysolutions-webhook.service';

export { PaymentIntentResult } from './services/paysolutions-intent.service';
export { PaymentStatusResult } from './services/paysolutions-confirmation.service';

/**
 * Facade over the decomposed PaySolutions money-inflow gateway.
 *
 * Behavior-preserving decompose: the 1908-LOC god-service split into four plain
 * sub-services constructed INTERNALLY (so the module + the 6 external consumers
 * + all 6 specs stay untouched — no provider/forwardRef churn). The 11-method
 * public surface + the ctor (incl. the forwardRef'd PaymentsService) are
 * unchanged; every public method one-line delegates.
 *
 *   - {@link PaySolutionsGatewayClient}      — DB-free config + createUiPayment dedup
 *   - {@link PaySolutionsIntentService}      — the 5 intent creators (NO regulated JE)
 *   - {@link PaySolutionsConfirmationService}— partial/online/saving confirm + status
 *   - {@link PaySolutionsWebhookService}     — REGULATED CORE: the line-1105
 *       Serializable webhook $tx (3 JEs, FIFO, idempotency, contract-close) AS
 *       ONE ATOM
 *
 * Sub-services are built LAZILY on first use (not in the ctor): under
 * forwardRef DI, NestJS returns a wrapped instance from the container while the
 * ctor's `this` is the raw target — so a host captured in the ctor would NOT
 * see post-construction spies installed on the container instance. Building on
 * first public-method call captures the wrapped `this`, so the webhook's
 * routing branches + post-tx notifications dispatch through the SAME facade
 * instance the existing specs spy on. The host arrows resolve their targets at
 * call time, so a spy installed after the first delegation is still honoured.
 */
@Injectable()
export class PaySolutionsService {
  private _services?: {
    gateway: PaySolutionsGatewayClient;
    intent: PaySolutionsIntentService;
    confirmation: PaySolutionsConfirmationService;
    webhook: PaySolutionsWebhookService;
  };

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private lineOaService: LineOaService,
    private integrationConfig: IntegrationConfigService,
    @Inject(forwardRef(() => OnlineOrderSaleAdapter))
    private saleAdapter: OnlineOrderSaleAdapter,
    private productsService: ProductsService,
    private journalAutoService: JournalAutoService,
    private paymentReceiptTemplate: PaymentReceiptTemplate,
    private vat60Reversal: Vat60dayReversalTemplate,
    @Inject(forwardRef(() => PaymentsService))
    private paymentsService: PaymentsService,
  ) {}

  /**
   * Lazily build (once) and return the four sub-services. Wiring:
   * GatewayClient → Intent; Confirmation (forwardRef'd PaymentsService threaded
   * through); Webhook(…, host) where `host` dispatches back through `this`
   * (the wrapped facade instance) so its routing + notifications hit the
   * methods the specs spy on.
   */
  private services() {
    if (!this._services) {
      const gateway = new PaySolutionsGatewayClient(this.config, this.integrationConfig);
      const intent = new PaySolutionsIntentService(
        gateway,
        this.prisma,
        this.lineOaService,
        this.config,
      );
      const confirmation = new PaySolutionsConfirmationService(
        this.prisma,
        this.lineOaService,
        this.saleAdapter,
        this.paymentsService,
      );
      const webhook = new PaySolutionsWebhookService(
        gateway,
        this.prisma,
        this.lineOaService,
        this.productsService,
        this.journalAutoService,
        this.paymentReceiptTemplate,
        this.vat60Reversal,
        {
          handlePartialPaymentCallback: (link, data) =>
            this.handlePartialPaymentCallback(link, data),
          confirmSavingPlanPayment: (id, linkId, data) =>
            this.confirmSavingPlanPayment(id, linkId, data),
          confirmOnlineOrderPayment: (id, data) =>
            this.confirmOnlineOrderPayment(id, data),
          sendPaymentSuccessNotification: (contractId, paymentId) =>
            this.sendPaymentSuccessNotification(contractId, paymentId),
          sendEarlyPayoffSuccessNotification: (contractId, paidAmount) =>
            this.sendEarlyPayoffSuccessNotification(contractId, paidAmount),
        },
      );
      this._services = { gateway, intent, confirmation, webhook };
    }
    return this._services;
  }

  // ── Intent creators (delegated to PaySolutionsIntentService) ──────────────

  createPaymentIntent(
    contractId: string,
    amount: number,
    description?: string,
    lineId?: string,
    installmentNo?: number,
  ): Promise<PaymentIntentResult> {
    return this.services().intent.createPaymentIntent(contractId, amount, description, lineId, installmentNo);
  }

  createOnlineOrderIntent(input: {
    onlineOrderId: string;
    amount: number;
    description: string;
    channel: 'PROMPTPAY_QR' | 'CREDIT_DEBIT_CARD';
  }): Promise<{ paymentLinkId: string; paymentUrl: string; qrCodeUrl?: string }> {
    return this.services().intent.createOnlineOrderIntent(input);
  }

  createEarlyPayoffQR(input: {
    contractId: string;
    amount: number;
    description?: string;
    quoteContext?: {
      originalAmount: number;
      savings: number;
      discountPct: number;
      remainingMonths: number;
    };
  }): Promise<{ paymentLinkId: string; paymentUrl: string; orderRef: string; sentToLine: boolean }> {
    return this.services().intent.createEarlyPayoffQR(input);
  }

  createPartialPaymentQR(input: {
    paymentId: string;
    amount: number;
    description?: string;
  }): Promise<{ partialPaymentLinkId: string; paymentUrl: string; orderRef: string; sentToLine: boolean }> {
    return this.services().intent.createPartialPaymentQR(input);
  }

  /** ปรับดิว QR — collect-first; reschedule executes on webhook confirm (เงินไม่เข้า ดิวไม่เลื่อน). */
  createRescheduleQR(input: {
    paymentId: string;
    daysToShift: number;
    splitMode: 'SINGLE' | 'SPLIT';
    requestedById: string;
  }): Promise<{
    partialPaymentLinkId: string;
    paymentUrl: string;
    orderRef: string;
    sentToLine: boolean;
    collectAmount: string;
    rescheduleFee: string;
    lateFee: string;
  }> {
    return this.services().intent.createRescheduleQR(input);
  }

  createSavingPlanIntent(input: {
    savingPlanId: string;
    amount: number;
    description: string;
  }): Promise<{ paymentLinkId: string; paymentUrl: string }> {
    return this.services().intent.createSavingPlanIntent(input);
  }

  // ── Webhook (delegated to PaySolutionsWebhookService) ─────────────────────

  verifyWebhookMerchant(merchantid: string): Promise<boolean> {
    return this.services().webhook.verifyWebhookMerchant(merchantid);
  }

  handlePaymentCallback(webhookData: Record<string, string>): Promise<void> {
    return this.services().webhook.handlePaymentCallback(webhookData);
  }

  // ── Confirmation + status (delegated to PaySolutionsConfirmationService) ──

  getPaymentStatus(paymentId: string): Promise<PaymentStatusResult> {
    return this.services().confirmation.getPaymentStatus(paymentId);
  }

  handlePartialPaymentCallback(
    link: PartialPaymentLink,
    webhookData: Record<string, string>,
  ): Promise<void> {
    return this.services().confirmation.handlePartialPaymentCallback(link, webhookData);
  }

  confirmOnlineOrderPayment(
    onlineOrderId: string,
    webhookData: Record<string, string>,
  ): Promise<void> {
    return this.services().confirmation.confirmOnlineOrderPayment(onlineOrderId, webhookData);
  }

  confirmSavingPlanPayment(
    savingPlanId: string,
    paymentLinkId: string,
    webhookData: Record<string, string>,
  ): Promise<void> {
    return this.services().confirmation.confirmSavingPlanPayment(savingPlanId, paymentLinkId, webhookData);
  }

  // ── Post-tx notifications (impl in PaySolutionsWebhookService) ────────────
  // Kept on the facade so the webhook's post-tx calls (routed through the host)
  // and the existing specs that spy on these instance methods both resolve to
  // the same target. Private (matching the original surface).

  private sendPaymentSuccessNotification(
    contractId: string,
    paymentId: string | null,
  ): Promise<void> {
    return this.services().webhook.sendPaymentSuccessNotification(contractId, paymentId);
  }

  private sendEarlyPayoffSuccessNotification(
    contractId: string,
    paidAmount: Prisma.Decimal,
  ): Promise<void> {
    return this.services().webhook.sendEarlyPayoffSuccessNotification(contractId, paidAmount);
  }
}
