import {
  Inject,
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  forwardRef,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { formatDateLong } from '../../utils/thai-date.util';
import { d, dAdd, dSub, dClose } from '../../utils/decimal.util';
import { OnlineOrderSaleAdapter } from '../shop-orders/online-order-sale.adapter';

// Pay Solutions external API timeout. Their published SLA is "instant"
// but real-world we've seen 5-10s on busy hours. 15s leaves headroom
// without holding our request thread forever.
const PAYSOLUTIONS_TIMEOUT_MS = 15_000;
import { ConfigService } from '@nestjs/config';
import { Prisma, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { buildPaymentSuccessFlex } from '../line-oa/flex-messages/payment-success.flex';
import { FlexMessagePayload } from '../line-oa/flex-messages/base-template';
import { IntegrationConfigService } from '../integrations/integration-config.service';

export interface PaymentIntentResult {
  paymentId: string;
  paymentUrl: string;
  gatewayRef: string;
  qrCodeUrl?: string;
}

export interface PaymentStatusResult {
  paymentId: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
  gatewayRef?: string;
  gatewayStatus?: string;
  amount: number;
  paidAt?: Date;
}

@Injectable()
export class PaySolutionsService {
  private readonly logger = new Logger(PaySolutionsService.name);
  private readonly returnUrl: string;
  private readonly apiBaseUrl: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private lineOaService: LineOaService,
    private integrationConfig: IntegrationConfigService,
    @Inject(forwardRef(() => OnlineOrderSaleAdapter))
    private saleAdapter: OnlineOrderSaleAdapter,
  ) {
    this.returnUrl = this.config.get<string>('PAYSOLUTIONS_RETURN_URL', '');
    this.apiBaseUrl = this.config.get<string>(
      'API_BASE_URL',
      'https://api.bestchoicephone.app',
    );
  }

  private async getMerchantId(): Promise<string> {
    return (await this.integrationConfig.getValue('paysolutions', 'merchantId')) || '';
  }

  private async getSecretKey(): Promise<string> {
    return (await this.integrationConfig.getValue('paysolutions', 'secretKey')) || '';
  }

  private async getApiKey(): Promise<string> {
    return (await this.integrationConfig.getValue('paysolutions', 'apiKey')) || '';
  }

  private async getApiUrl(): Promise<string> {
    return (
      (await this.integrationConfig.getValue('paysolutions', 'apiUrl')) ||
      'https://apis.paysolutions.asia'
    );
  }

  private async getTerminalId(): Promise<string> {
    return (await this.integrationConfig.getValue('paysolutions', 'terminalId')) || 'TID00001';
  }

  /**
   * สร้าง payment intent — เรียก Pay Solutions API สร้าง payment request
   * ได้ payment URL สำหรับ redirect ลูกค้าไปชำระเงิน
   */
  async createPaymentIntent(
    contractId: string,
    amount: number,
    description?: string,
    lineId?: string,
    installmentNo?: number,
  ): Promise<PaymentIntentResult> {
    // ตรวจสอบว่า contract มีอยู่จริง
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        customer: { select: { name: true, phone: true, email: true, lineId: true } },
      },
    });

    if (!contract || contract.deletedAt) {
      throw new NotFoundException('ไม่พบสัญญาที่ระบุ');
    }

    // ตรวจสอบว่า contract เป็นของ customer ที่ผูก LINE (บังคับ — ป้องกันสร้าง intent โดยไม่ยืนยันตัวตน)
    if (!lineId) {
      throw new BadRequestException('กรุณาระบุ LINE ID เพื่อยืนยันตัวตน');
    }
    if (contract.customer.lineId !== lineId) {
      throw new BadRequestException('สัญญานี้ไม่ตรงกับบัญชี LINE ของคุณ');
    }

    // สร้าง unique reference (max 12 chars ตาม API spec)
    const orderRef = `BC${Date.now().toString(36).toUpperCase()}`.slice(0, 12);

    // หา payment record ที่ต้องชำระ (ถ้าระบุ installmentNo)
    let paymentRecord: Awaited<ReturnType<typeof this.prisma.payment.findUnique>> = null;
    if (installmentNo) {
      paymentRecord = await this.prisma.payment.findUnique({
        where: { contractId_installmentNo: { contractId, installmentNo } },
      });
      if (!paymentRecord) {
        throw new NotFoundException(`ไม่พบงวดที่ ${installmentNo}`);
      }
      if (paymentRecord.status === 'PAID') {
        throw new BadRequestException(`งวดที่ ${installmentNo} ชำระเรียบร้อยแล้ว`);
      }

      // Validate amount matches actual outstanding for this installment
      const expectedAmount = dSub(dAdd(paymentRecord.amountDue, paymentRecord.lateFee), paymentRecord.amountPaid);
      if (!dClose(amount, expectedAmount)) {
        throw new BadRequestException(
          `ยอดชำระไม่ตรง: ส่งมา ${amount.toLocaleString()} บาท แต่ยอดค้างจริง ${expectedAmount.toNumber().toLocaleString()} บาท`,
        );
      }
    }

    // เรียก Pay Solutions API v2 (ตาม Web API Guideline v1.2.2)
    const returnUrlWithRef = `${this.returnUrl || `${this.config.get('FRONTEND_URL', 'http://localhost:5173')}/liff/contract`}?ref=${orderRef}`;

    const paymentPayload = {
      merchantId: await this.getMerchantId(),
      customerEmail: contract.customer.email || 'noreply@bestchoice.com',
      referenceNo: orderRef,
      description: description || `ชำระค่างวด สัญญา ${contract.contractNumber}`,
      amount,
      paymentChannel: 'Qrcode',
      paymentGateway: 'Promptpay',
      currencyCode: '00',
      lang: 'TH',
      returnUrl: returnUrlWithRef,
      postbackUrl: `${this.apiBaseUrl}/api/paysolutions/webhook`,
      terminalId: await this.getTerminalId(),
      keyVersion: 1,
    };

    let gatewayResponse: Record<string, unknown>;
    let paymentUrl: string;
    let gatewayRef: string;

    // AbortController-based timeout. Without this a hung gateway would
    // keep our request thread alive indefinitely and the customer would
    // see an infinite spinner.
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), PAYSOLUTIONS_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${await this.getApiUrl()}/payment/gateway/v2/ui-payments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'apiKey': await this.getApiKey(),
            'secretKey': await this.getSecretKey(),
          },
          body: JSON.stringify(paymentPayload),
          signal: abortController.signal,
        },
      );

      gatewayResponse = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        const status = gatewayResponse.status as Record<string, string> | undefined;
        this.logger.error(
          `Pay Solutions API error: ${status?.statusCode} ${status?.message} — ${JSON.stringify(gatewayResponse)}`,
        );
        throw new InternalServerErrorException(
          `ไม่สามารถสร้างรายการชำระเงินได้: ${status?.message || 'กรุณาลองใหม่'}`,
        );
      }

      // Pay Solutions v2 response: { redirectUrl, transactionId, status }
      paymentUrl = (gatewayResponse.redirectUrl as string) || '';
      gatewayRef = (gatewayResponse.transactionId as string) || orderRef;

      if (!paymentUrl) {
        this.logger.error(`Pay Solutions missing redirectUrl: ${JSON.stringify(gatewayResponse)}`);
        throw new InternalServerErrorException('ไม่ได้รับลิงก์ชำระเงินจากระบบ');
      }
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      // AbortError fires when the timeout trips. Surface a clear Thai
      // message to the user and tag the Sentry event so we can spot a
      // gateway slowdown.
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      if (isTimeout) {
        this.logger.error(
          `Pay Solutions timeout after ${PAYSOLUTIONS_TIMEOUT_MS}ms for orderRef=${orderRef}`,
        );
        Sentry.captureMessage('paysolutions-timeout', {
          level: 'warning',
          tags: { critical: 'paysolutions-timeout', orderRef },
          extra: { contractId, amount, timeoutMs: PAYSOLUTIONS_TIMEOUT_MS },
        });
        throw new InternalServerErrorException(
          'ระบบชำระเงินใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง',
        );
      }
      this.logger.error(`Pay Solutions API call failed: ${error}`);
      throw new InternalServerErrorException('ไม่สามารถเชื่อมต่อระบบชำระเงินได้ กรุณาลองใหม่');
    } finally {
      clearTimeout(timeoutHandle);
    }

    // CRITICAL: gateway intent ได้สร้างไปแล้ว — ถ้า DB write fail ตรงนี้
    // เราจะมี orphaned gateway intent (ลูกค้า redirect ไปจ่ายได้แต่ webhook
    // จะหา PaymentLink ไม่เจอ → ลูกค้าจ่ายเงินแต่ระบบไม่บันทึก)
    // → wrap ใน $transaction ให้ payment.update + paymentLink.create เป็น atomic
    // → ถ้า fail ส่ง Sentry ทันทีพร้อม gatewayRef เพื่อให้ ops reconcile ได้
    try {
      await this.prisma.$transaction(async (tx) => {
        if (paymentRecord) {
          await tx.payment.update({
            where: { id: paymentRecord.id },
            data: {
              gatewayRef,
              gatewayStatus: 'PENDING',
              gatewayResponse: gatewayResponse as object,
              paymentMethod: PaymentMethod.ONLINE_GATEWAY,
            },
          });
        }

        await tx.paymentLink.create({
          data: {
            token: orderRef,
            contractId,
            paymentId: paymentRecord?.id || null,
            amount,
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min expiry
          },
        });
      });
    } catch (dbError) {
      // Gateway intent created but DB tracking failed → ORPHAN risk
      this.logger.error(
        `CRITICAL: PaySolutions intent created but DB tracking failed. orderRef=${orderRef} gatewayRef=${gatewayRef} contractId=${contractId}`,
      );
      Sentry.captureException(dbError, {
        level: 'fatal',
        tags: {
          critical: 'paysolutions-orphan-intent',
          orderRef,
          gatewayRef,
        },
        extra: {
          contractId,
          paymentRecordId: paymentRecord?.id,
          amount,
        },
      });
      throw new InternalServerErrorException(
        'ระบบบันทึกข้อมูลชำระเงินไม่สำเร็จ กรุณาติดต่อแอดมิน',
      );
    }

    this.logger.log(
      `Payment intent created: ${orderRef} for contract ${contractId}, amount ${amount}`,
    );

    return {
      paymentId: paymentRecord?.id || orderRef,
      paymentUrl,
      gatewayRef,
    };
  }

  /**
   * สร้าง payment intent สำหรับ online order (ร้านค้าออนไลน์)
   * — เรียก Pay Solutions API สร้างลิงก์ชำระเงิน
   * — บันทึก PaymentLink ที่ contractId=null + link กลับมาหา OnlineOrder
   * — Retry safe: ถ้ามี PaymentLink ACTIVE อยู่แล้วจะ reuse ไม่สร้างใหม่
   */
  async createOnlineOrderIntent(input: {
    onlineOrderId: string;
    amount: number;
    description: string;
    channel: 'PROMPTPAY_QR' | 'CREDIT_DEBIT_CARD';
  }): Promise<{ paymentLinkId: string; paymentUrl: string; qrCodeUrl?: string }> {
    const order = await this.prisma.onlineOrder.findUnique({
      where: { id: input.onlineOrderId },
      include: { customer: { select: { email: true, name: true } } },
    });
    if (!order) throw new NotFoundException('ไม่พบคำสั่งซื้อ');
    if (order.paymentLinkId) {
      const existing = await this.prisma.paymentLink.findUnique({
        where: { id: order.paymentLinkId },
      });
      if (existing && existing.status === 'ACTIVE') {
        // Reuse — avoid creating a new gateway intent on retry
        return { paymentLinkId: existing.id, paymentUrl: '' };
      }
    }

    const orderRef = `ON${Date.now().toString(36).toUpperCase()}`.slice(0, 12);
    const returnUrlBase =
      this.returnUrl || `${this.config.get('FRONTEND_URL', 'http://localhost:5174')}/orders`;
    const returnUrl = `${returnUrlBase}/${order.orderNumber}`;

    const paymentPayload: Record<string, unknown> = {
      merchantId: await this.getMerchantId(),
      customerEmail: order.customer.email || 'noreply@bestchoice.com',
      referenceNo: orderRef,
      description: input.description,
      amount: input.amount,
      paymentChannel: input.channel === 'PROMPTPAY_QR' ? 'Qrcode' : 'CreditDebit',
      paymentGateway: input.channel === 'PROMPTPAY_QR' ? 'Promptpay' : undefined,
      currencyCode: '00',
      lang: 'TH',
      returnUrl,
      postbackUrl: `${this.apiBaseUrl}/api/paysolutions/webhook`,
      terminalId: await this.getTerminalId(),
      keyVersion: 1,
    };

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), PAYSOLUTIONS_TIMEOUT_MS);
    let gatewayResponse: Record<string, unknown>;
    let paymentUrl: string;

    try {
      const response = await fetch(
        `${await this.getApiUrl()}/payment/gateway/v2/ui-payments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            apiKey: await this.getApiKey(),
            secretKey: await this.getSecretKey(),
          },
          body: JSON.stringify(paymentPayload),
          signal: abortController.signal,
        },
      );
      gatewayResponse = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        const status = gatewayResponse.status as Record<string, string> | undefined;
        throw new InternalServerErrorException(
          `ไม่สามารถสร้างรายการชำระเงินได้: ${status?.message || 'กรุณาลองใหม่'}`,
        );
      }
      paymentUrl = (gatewayResponse.redirectUrl as string) || '';
      if (!paymentUrl) {
        throw new InternalServerErrorException('ไม่ได้รับลิงก์ชำระเงินจากระบบ');
      }
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      if (isTimeout) {
        Sentry.captureMessage('paysolutions-online-timeout', {
          level: 'warning',
          tags: { critical: 'paysolutions-online-timeout', orderRef },
          extra: { onlineOrderId: input.onlineOrderId, amount: input.amount },
        });
        throw new InternalServerErrorException(
          'ระบบชำระเงินใช้เวลานานเกินไป กรุณาลองใหม่',
        );
      }
      throw new InternalServerErrorException('ไม่สามารถเชื่อมต่อระบบชำระเงินได้');
    } finally {
      clearTimeout(timeoutHandle);
    }

    try {
      const paymentLink = await this.prisma.paymentLink.create({
        data: {
          token: orderRef,
          amount: input.amount,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });
      await this.prisma.onlineOrder.update({
        where: { id: input.onlineOrderId },
        data: { paymentLinkId: paymentLink.id },
      });
      this.logger.log(
        `Online order payment intent: ${orderRef} for order ${input.onlineOrderId}`,
      );
      return { paymentLinkId: paymentLink.id, paymentUrl };
    } catch (dbError) {
      Sentry.captureException(dbError, {
        level: 'fatal',
        tags: { critical: 'paysolutions-online-orphan', orderRef },
        extra: { onlineOrderId: input.onlineOrderId },
      });
      throw new InternalServerErrorException('ระบบบันทึกข้อมูลชำระเงินไม่สำเร็จ');
    }
  }

  /**
   * ตรวจสอบ webhook callback จาก Pay Solutions
   * Pay Solutions ส่ง form POST กลับมาพร้อม merchantid — ตรวจว่าตรงกับ config
   */
  async verifyWebhookMerchant(merchantid: string): Promise<boolean> {
    const merchantId = await this.getMerchantId();
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
        await this.confirmOnlineOrderPayment(order.id, webhookData);
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
      // ชำระสำเร็จ
      await this.prisma.$transaction(async (tx) => {
        // อัปเดต PaymentLink
        await tx.paymentLink.update({
          where: { id: paymentLink.id },
          data: { status: 'USED', usedAt: new Date() },
        });

        // อัปเดต Payment record ถ้ามี
        if (paymentLink.paymentId) {
          await tx.payment.update({
            where: { id: paymentLink.paymentId },
            data: {
              status: 'PAID',
              amountPaid: total && !isNaN(Number(total)) ? new Prisma.Decimal(total) : paymentLink.amount,
              paidDate: new Date(),
              paidAt: new Date(),
              paymentMethod: PaymentMethod.ONLINE_GATEWAY,
              gatewayRef: refno,
              gatewayStatus: 'SUCCESS',
              gatewayResponse: webhookData as object,
              notes: `ชำระผ่าน Pay Solutions (${transaction_id || refno})`,
            },
          });
        }
      });

      this.logger.log(`Payment SUCCESS: refno=${refno}, contractId=${paymentLink.contractId}`);

      // ส่ง LINE notification แจ้งลูกค้า
      await this.sendPaymentSuccessNotification(paymentLink.contractId, paymentLink.paymentId);
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
  private async sendPaymentSuccessNotification(
    contractId: string,
    paymentId: string | null,
  ): Promise<void> {
    try {
      const contract = await this.prisma.contract.findUnique({
        where: { id: contractId },
        include: {
          customer: { select: { name: true, lineId: true } },
          payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
        },
      });

      if (!contract?.customer.lineId) return;

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

      await this.lineOaService.sendFlexMessage(contract.customer.lineId, flex);
      this.logger.log(`LINE notification sent for contract ${contract.contractNumber}`);
    } catch (err) {
      // ไม่ให้ notification error ทำให้ webhook fail
      this.logger.error(`Failed to send LINE notification: ${err}`);
    }
  }

  /**
   * ดึงสถานะ payment สำหรับ frontend polling
   */
  async getPaymentStatus(paymentId: string): Promise<PaymentStatusResult> {
    // ลองหาจาก Payment ID ก่อน
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (payment) {
      return {
        paymentId: payment.id,
        status: payment.status === 'PAID' ? 'PAID' : payment.gatewayStatus === 'FAILED' ? 'FAILED' : 'PENDING',
        gatewayRef: payment.gatewayRef || undefined,
        gatewayStatus: payment.gatewayStatus || undefined,
        amount: Number(payment.amountDue),
        paidAt: payment.paidAt || undefined,
      };
    }

    // ลองหาจาก PaymentLink token (กรณี order reference)
    const link = await this.prisma.paymentLink.findFirst({
      where: { token: paymentId },
      include: { payment: true },
    });

    if (!link) {
      throw new NotFoundException('ไม่พบรายการชำระเงิน');
    }

    if (link.status === 'USED' && link.payment?.status === 'PAID') {
      return {
        paymentId: link.payment.id,
        status: 'PAID',
        gatewayRef: link.payment.gatewayRef || undefined,
        gatewayStatus: link.payment.gatewayStatus || undefined,
        amount: Number(link.amount),
        paidAt: link.payment.paidAt || undefined,
      };
    }

    if (link.status === 'EXPIRED') {
      return {
        paymentId: link.id,
        status: 'FAILED',
        amount: Number(link.amount),
      };
    }

    return {
      paymentId: link.id,
      status: 'PENDING',
      amount: Number(link.amount),
    };
  }

  /**
   * ยืนยันชำระเงินสำเร็จของ online order
   * — อัปเดต OnlineOrder.status → PAID
   * — อัปเดต ProductReservation.status → CONSUMED
   * — ส่ง LINE flex message แจ้งลูกค้า (ถ้ามี lineId)
   * — STUB: Task 9 จะเพิ่ม OnlineOrderSaleAdapter เพื่อสร้าง Sale + move product + award loyalty
   */
  async confirmOnlineOrderPayment(
    onlineOrderId: string,
    webhookData: Record<string, string>,
  ): Promise<void> {
    const order = await this.prisma.onlineOrder.findUnique({
      where: { id: onlineOrderId },
      include: { customer: true, product: true, reservation: true },
    });
    if (!order) {
      this.logger.warn(`confirmOnlineOrderPayment: order ${onlineOrderId} not found`);
      return;
    }
    if (
      order.status === 'PAID' ||
      order.status === 'PACKING' ||
      order.status === 'SHIPPED'
    ) {
      this.logger.log(
        `Order ${order.orderNumber} already confirmed — idempotent skip`,
      );
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.onlineOrder.update({
        where: { id: onlineOrderId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          paymentRef: webhookData.transaction_id || webhookData.refno || null,
        },
      });
      await tx.productReservation.update({
        where: { id: order.reservationId },
        data: { status: 'CONSUMED', consumedById: order.id },
      });
    });

    // Create a Sale record for the paid online order. Adapter moves product to
    // SOLD_CASH, applies loyalty redemption, and transitions the OnlineOrder to
    // PACKING. Failures are logged (not re-thrown) — webhook must still return
    // 200 so PaySolutions doesn't retry, and admin can reconcile manually.
    try {
      await this.saleAdapter.createForOnlineOrder(order.id);
    } catch (err) {
      this.logger.error(
        `Failed to create Sale for online order ${order.orderNumber}: ${err}`,
      );
      Sentry.captureException(err, {
        level: 'error',
        tags: { critical: 'online-order-sale-failed', orderNumber: order.orderNumber },
      });
      // Don't re-throw — Sale can be created manually by admin if needed
    }

    if (order.customer.lineId) {
      try {
        await this.lineOaService.sendFlexMessage(
          order.customer.lineId,
          this.buildOrderPaidFlex(order),
        );
      } catch (err) {
        this.logger.warn(
          `Failed to send LINE notification for order ${order.orderNumber}: ${err}`,
        );
      }
    }
  }

  /**
   * สร้าง flex message แจ้งยืนยันชำระเงิน online order สำเร็จ
   */
  private buildOrderPaidFlex(order: {
    orderNumber: string;
    totalAmount: Prisma.Decimal;
    product: { name: string };
  }): FlexMessagePayload {
    return {
      type: 'flex',
      altText: `ชำระเงินคำสั่งซื้อ ${order.orderNumber} สำเร็จ`,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: 'ชำระเงินสำเร็จ', weight: 'bold', size: 'lg' },
            {
              type: 'text',
              text: `คำสั่งซื้อ ${order.orderNumber}`,
              size: 'md',
              margin: 'md',
            },
            { type: 'text', text: order.product.name, size: 'sm', color: '#666666' },
            { type: 'separator', margin: 'md' },
            {
              type: 'text',
              text: `ยอดรวม ฿${Number(order.totalAmount).toLocaleString()}`,
              size: 'md',
              margin: 'md',
              weight: 'bold',
            },
            {
              type: 'text',
              text: 'ทางร้านจะจัดส่งภายใน 1 วันทำการ',
              size: 'xs',
              color: '#888888',
              margin: 'md',
              wrap: true,
            },
          ],
        },
      },
    };
  }
}
