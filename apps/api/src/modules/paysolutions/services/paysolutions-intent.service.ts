import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineOaService } from '../../line-oa/line-oa.service';
import { buildEarlyPayoffQRFlex } from '../../line-oa/flex-messages/early-payoff-qr.flex';
import { buildPartialPaymentQRFlex } from '../../line-oa/flex-messages/partial-payment-qr.flex';
import { buildRescheduleQRFlex } from '../../line-oa/flex-messages/reschedule-qr.flex';
import { dAdd, dSub, dClose } from '../../../utils/decimal.util';
import { loadLateFeeConfig } from '../../../utils/late-fee.util';
import { computeRescheduleQuote } from '../../../utils/reschedule-quote.util';
import { PaySolutionsGatewayClient, PAYSOLUTIONS_TIMEOUT_MS } from './paysolutions-gateway.client';

export interface PaymentIntentResult {
  paymentId: string;
  paymentUrl: string;
  gatewayRef: string;
  qrCodeUrl?: string;
}

/**
 * Owns the five "mint a Pay Solutions intent" flows. NO regulated JE — the
 * line-266 intent-tracking $transaction does NOT touch the ledger. Constructed
 * internally by {@link PaySolutionsService}; the gateway mechanics live in
 * {@link PaySolutionsGatewayClient}.
 */
@Injectable()
export class PaySolutionsIntentService {
  private readonly logger = new Logger(PaySolutionsIntentService.name);
  private readonly returnUrl: string;
  private readonly apiBaseUrl: string;

  constructor(
    private gateway: PaySolutionsGatewayClient,
    private prisma: PrismaService,
    private lineOaService: LineOaService,
    private config: ConfigService,
  ) {
    this.returnUrl = this.config.get<string>('PAYSOLUTIONS_RETURN_URL', '');
    this.apiBaseUrl = this.config.get<string>(
      'API_BASE_URL',
      'https://api.bestchoicephone.app',
    );
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
        customer: { select: { name: true, phone: true, email: true, lineIdFinance: true } },
      },
    });

    if (!contract || contract.deletedAt) {
      throw new NotFoundException('ไม่พบสัญญาที่ระบุ');
    }

    // ตรวจสอบว่า contract เป็นของ customer ที่ผูก LINE (บังคับ — ป้องกันสร้าง intent โดยไม่ยืนยันตัวตน)
    if (!lineId) {
      throw new BadRequestException('กรุณาระบุ LINE ID เพื่อยืนยันตัวตน');
    }
    if (contract.customer.lineIdFinance !== lineId) {
      throw new BadRequestException('สัญญานี้ไม่ตรงกับบัญชี LINE ของคุณ');
    }

    // PaySolutions referenceNo: max 12 chars, must be unique.
    // PDF sample uses all-digits ("123456789012") and the payment UI
    // at payments.paysolutions.asia rejected alphanumeric refs with
    // "Invalid data, please check the referenceNo" — so stick to digits.
    // Date.now() is 13 digits; last 12 gives us a unique ref per ms.
    const orderRef = String(Date.now()).slice(-12);

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
      merchantId: await this.gateway.getMerchantId(),
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
      terminalId: await this.gateway.getTerminalId(),
      keyVersion: 1,
    };

    const { gatewayResponse, paymentUrl } = await this.gateway.createUiPayment(paymentPayload, {
      orderRef,
      buildErrorLog: (response, gr, parsed) =>
        `Pay Solutions API error: HTTP ${response.status} statusCode=${parsed.statusCode} message="${parsed.message}" — ${JSON.stringify(gr)}`,
      errorMessagePrefix: 'ไม่สามารถสร้างรายการชำระเงินได้',
      buildMissingUrlLog: (gr) => `Pay Solutions missing redirectUrl: ${JSON.stringify(gr)}`,
      missingUrlMessage: 'ไม่ได้รับลิงก์ชำระเงินจากระบบ',
      buildTimeoutLog: () =>
        `Pay Solutions timeout after ${PAYSOLUTIONS_TIMEOUT_MS}ms for orderRef=${orderRef}`,
      timeoutSentryKey: 'paysolutions-timeout',
      timeoutSentryExtra: { contractId, amount, timeoutMs: PAYSOLUTIONS_TIMEOUT_MS },
      timeoutMessage: 'ระบบชำระเงินใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง',
      buildGenericErrorLog: (error) => `Pay Solutions API call failed: ${error}`,
      genericErrorMessage: 'ไม่สามารถเชื่อมต่อระบบชำระเงินได้ กรุณาลองใหม่',
    });

    // Pay Solutions v2 response: { redirectUrl, transactionId, status }
    const gatewayRef = (gatewayResponse.transactionId as string) || orderRef;

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

    // Numeric-only ref (see createPaymentIntent for rationale).
    const orderRef = String(Date.now()).slice(-12);
    const returnUrlBase =
      this.returnUrl || `${this.config.get('FRONTEND_URL', 'http://localhost:5174')}/orders`;
    const returnUrl = `${returnUrlBase}/${order.orderNumber}`;

    const paymentPayload: Record<string, unknown> = {
      merchantId: await this.gateway.getMerchantId(),
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
      terminalId: await this.gateway.getTerminalId(),
      keyVersion: 1,
    };

    const { paymentUrl } = await this.gateway.createUiPayment(paymentPayload, {
      orderRef,
      buildErrorLog: (response, gr, parsed) =>
        `Pay Solutions online-order API error: HTTP ${response.status} statusCode=${parsed.statusCode} message="${parsed.message}" — ${JSON.stringify(gr)}`,
      errorMessagePrefix: 'ไม่สามารถสร้างรายการชำระเงินได้',
      missingUrlMessage: 'ไม่ได้รับลิงก์ชำระเงินจากระบบ',
      timeoutSentryKey: 'paysolutions-online-timeout',
      timeoutSentryExtra: { onlineOrderId: input.onlineOrderId, amount: input.amount },
      timeoutMessage: 'ระบบชำระเงินใช้เวลานานเกินไป กรุณาลองใหม่',
      genericErrorMessage: 'ไม่สามารถเชื่อมต่อระบบชำระเงินได้',
    });

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
   * Cashier-initiated early-payoff QR (no LIFF gating).
   * Used by ContractEarlyPayoff overlay to generate a PromptPay QR a customer
   * can scan in-store or receive via LINE OA. Webhook auto-closes contract
   * via existing handlePaymentCallback path (referenceNo lookup).
   */
  async createEarlyPayoffQR(input: {
    contractId: string;
    amount: number;
    description?: string;
    /** Pre-computed quote info — used to enrich the LINE Flex push. */
    quoteContext?: {
      originalAmount: number;
      savings: number;
      discountPct: number;
      remainingMonths: number;
    };
  }): Promise<{ paymentLinkId: string; paymentUrl: string; orderRef: string; sentToLine: boolean }> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: input.contractId },
      include: { customer: { select: { email: true, name: true, lineIdFinance: true } } },
    });
    if (!contract || contract.deletedAt) {
      throw new NotFoundException('ไม่พบสัญญา');
    }

    const orderRef = String(Date.now()).slice(-12);
    const returnUrlBase =
      this.returnUrl || `${this.config.get('FRONTEND_URL', 'http://localhost:5173')}/payments`;
    const returnUrl = `${returnUrlBase}?payoff=${contract.contractNumber}`;

    const paymentPayload: Record<string, unknown> = {
      merchantId: await this.gateway.getMerchantId(),
      customerEmail: contract.customer.email || 'noreply@bestchoice.com',
      referenceNo: orderRef,
      description: input.description || `ปิดยอดสัญญา ${contract.contractNumber}`,
      amount: input.amount,
      paymentChannel: 'Qrcode',
      paymentGateway: 'Promptpay',
      currencyCode: '00',
      lang: 'TH',
      returnUrl,
      postbackUrl: `${this.apiBaseUrl}/api/paysolutions/webhook`,
      terminalId: await this.gateway.getTerminalId(),
      keyVersion: 1,
    };

    const { paymentUrl } = await this.gateway.createUiPayment(paymentPayload, {
      orderRef,
      buildErrorLog: (response, gr) =>
        `Pay Solutions early-payoff API error: ${response.status} ${JSON.stringify(gr)}`,
      errorMessagePrefix: 'ไม่สามารถสร้าง QR ได้',
      missingUrlMessage: 'ไม่ได้รับลิงก์ชำระเงิน',
      timeoutSentryKey: 'paysolutions-payoff-timeout',
      timeoutSentryExtra: { contractId: input.contractId, amount: input.amount },
      timeoutMessage: 'ระบบชำระเงินใช้เวลานานเกินไป',
      genericErrorMessage: 'ไม่สามารถเชื่อมต่อระบบชำระเงินได้',
    });

    try {
      const paymentLink = await this.prisma.paymentLink.create({
        data: {
          token: orderRef,
          amount: input.amount,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          contractId: input.contractId,
        },
      });
      this.logger.log(
        `Early-payoff QR created: ${orderRef} for contract ${input.contractId}, amount ${input.amount}`,
      );

      // Best-effort push Flex to customer's LINE OA (FINANCE channel).
      // Failure here doesn't abort — cashier can resend or fall back to in-store QR.
      let sentToLine = false;
      const lineId = contract.customer.lineIdFinance;
      if (lineId && input.quoteContext) {
        try {
          const flex = buildEarlyPayoffQRFlex({
            customerName: contract.customer.name,
            contractNumber: contract.contractNumber,
            totalPayoff: input.amount,
            originalAmount: input.quoteContext.originalAmount,
            savings: input.quoteContext.savings,
            discountPct: input.quoteContext.discountPct,
            paymentUrl,
            orderRef,
            remainingMonths: input.quoteContext.remainingMonths,
          });
          await this.lineOaService.pushMessage(lineId, [flex], 'line-finance');
          sentToLine = true;
          this.logger.log(`Early-payoff Flex pushed to LINE: contract=${contract.contractNumber} lineId=${lineId.slice(0, 8)}...`);
        } catch (pushErr) {
          this.logger.error(`Early-payoff Flex push failed: ${pushErr}`);
          // swallow — don't abort the QR creation
        }
      }

      return { paymentLinkId: paymentLink.id, paymentUrl, orderRef, sentToLine };
    } catch (dbError) {
      Sentry.captureException(dbError, {
        level: 'fatal',
        tags: { critical: 'paysolutions-payoff-orphan', orderRef },
        extra: { contractId: input.contractId },
      });
      throw new InternalServerErrorException('ระบบบันทึกข้อมูลชำระเงินไม่สำเร็จ');
    }
  }

  /**
   * Cashier-initiated PARTIAL payment QR.
   *
   * Wizard flow: cashier opens RecordPaymentWizard for a Payment row, types
   * an amount (typically < installment total), picks method=QR, clicks "ส่ง QR".
   * We:
   *   1. Cancel any earlier active PartialPaymentLink for the same Payment
   *      (single outstanding QR per installment — avoids customer paying twice).
   *   2. Call PaySolutions to mint a PromptPay QR with the requested amount.
   *   3. Save a PartialPaymentLink row (24h expiry) tracking the open QR.
   *   4. Best-effort push a STYLE_D info-role Flex to the customer's LINE OA.
   *
   * When the webhook fires, handlePaymentCallback looks up the token in
   * PartialPaymentLink first and routes through PaymentService.recordPayment
   * with case='PARTIAL' so the existing tolerance/JE/snapshot pipeline runs
   * exactly as if the cashier had recorded it manually.
   */
  async createPartialPaymentQR(input: {
    paymentId: string;
    amount: number;
    description?: string;
  }): Promise<{ partialPaymentLinkId: string; paymentUrl: string; orderRef: string; sentToLine: boolean }> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: input.paymentId },
      include: {
        contract: {
          include: { customer: { select: { id: true, email: true, name: true, lineIdFinance: true } } },
        },
      },
    });
    if (!payment || payment.deletedAt) {
      throw new NotFoundException('ไม่พบรายการชำระ');
    }
    if (payment.status === 'PAID') {
      throw new BadRequestException('งวดนี้ชำระครบแล้ว');
    }
    if (input.amount <= 0) {
      throw new BadRequestException('ยอดที่ส่ง QR ต้องมากกว่า 0');
    }

    // Single outstanding QR per installment — cancel any earlier active one.
    await this.prisma.partialPaymentLink.updateMany({
      where: { paymentId: input.paymentId, status: 'ACTIVE' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    const orderRef = String(Date.now()).slice(-12);
    const returnUrlBase =
      this.returnUrl || `${this.config.get('FRONTEND_URL', 'http://localhost:5173')}/payments`;
    const returnUrl = `${returnUrlBase}?partial=${payment.contract.contractNumber}`;

    const paymentPayload: Record<string, unknown> = {
      merchantId: await this.gateway.getMerchantId(),
      customerEmail: payment.contract.customer.email || 'noreply@bestchoice.com',
      referenceNo: orderRef,
      description:
        input.description ||
        `แบ่งชำระงวด ${payment.installmentNo} สัญญา ${payment.contract.contractNumber}`,
      amount: input.amount,
      paymentChannel: 'Qrcode',
      paymentGateway: 'Promptpay',
      currencyCode: '00',
      lang: 'TH',
      returnUrl,
      postbackUrl: `${this.apiBaseUrl}/api/paysolutions/webhook`,
      terminalId: await this.gateway.getTerminalId(),
      keyVersion: 1,
    };

    const { gatewayResponse, paymentUrl } = await this.gateway.createUiPayment(paymentPayload, {
      orderRef,
      buildErrorLog: (response, gr) =>
        `Pay Solutions partial-payment API error: ${response.status} ${JSON.stringify(gr)}`,
      errorMessagePrefix: 'ไม่สามารถสร้าง QR ได้',
      missingUrlMessage: 'ไม่ได้รับลิงก์ชำระเงิน',
      timeoutSentryKey: 'paysolutions-partial-timeout',
      timeoutSentryExtra: { paymentId: input.paymentId, amount: input.amount },
      timeoutMessage: 'ระบบชำระเงินใช้เวลานานเกินไป',
      genericErrorMessage: 'ไม่สามารถเชื่อมต่อระบบชำระเงินได้',
    });

    try {
      const link = await this.prisma.partialPaymentLink.create({
        data: {
          paymentId: input.paymentId,
          contractId: payment.contractId,
          customerId: payment.contract.customer.id,
          token: orderRef,
          amount: input.amount,
          gatewayRef: (gatewayResponse.refNo as string | undefined) ?? null,
          paymentUrl,
          status: 'ACTIVE',
          // 24h — generous window so customers can scan later in the day
          // (vs. the 30-min PaymentLink default for in-checkout flows).
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      this.logger.log(
        `Partial-payment QR created: ${orderRef} for payment ${input.paymentId}, amount ${input.amount}`,
      );

      let sentToLine = false;
      const lineId = payment.contract.customer.lineIdFinance;
      if (lineId) {
        try {
          const totalInstallments = await this.prisma.payment.count({
            where: { contractId: payment.contractId, deletedAt: null },
          });
          const flex = buildPartialPaymentQRFlex({
            customerName: payment.contract.customer.name,
            contractNumber: payment.contract.contractNumber,
            installmentNo: payment.installmentNo,
            totalInstallments,
            fullAmount: Number(payment.amountDue),
            partialAmount: input.amount,
            paymentUrl,
            orderRef,
          });
          await this.lineOaService.pushMessage(lineId, [flex], 'line-finance');
          sentToLine = true;
          this.logger.log(
            `Partial-payment Flex pushed to LINE: payment=${input.paymentId} lineId=${lineId.slice(0, 8)}...`,
          );
        } catch (pushErr) {
          this.logger.error(`Partial-payment Flex push failed: ${pushErr}`);
          // swallow — the cashier can resend or fall back to manual record
        }
      }

      return { partialPaymentLinkId: link.id, paymentUrl, orderRef, sentToLine };
    } catch (dbError) {
      Sentry.captureException(dbError, {
        level: 'fatal',
        tags: { critical: 'paysolutions-partial-orphan', orderRef },
        extra: { paymentId: input.paymentId },
      });
      throw new InternalServerErrorException('ระบบบันทึกข้อมูลชำระเงินไม่สำเร็จ');
    }
  }

  /**
   * ปรับดิว (reschedule) QR — เงินไม่เข้า ดิวไม่เลื่อน (owner directive 2026-07-02).
   *
   * Mints a PromptPay QR for the collect amount (6a: ค่าธรรมเนียม + ค่าปรับ;
   * 6b: ค่าปรับเท่านั้น) and stores a PartialPaymentLink with purpose='RESCHEDULE'
   * carrying the frozen quote in metadata. The reschedule itself is NOT executed
   * here — the PaySolutions webhook routes a paid RESCHEDULE link through
   * PaymentsService.rescheduleWithCollect, which posts the collect JE + resets the
   * late fee + shifts due dates in one atom. Link expires in 24h via the existing
   * partial-payment-expire cron (expired → no money → no reschedule).
   *
   * Zero-collect (6b, no late fee) is rejected — the cashier should confirm
   * directly in the overlay; a 0-baht QR is meaningless.
   */
  async createRescheduleQR(input: {
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
    const payment = await this.prisma.payment.findUnique({
      where: { id: input.paymentId },
      include: {
        contract: {
          include: { customer: { select: { id: true, email: true, name: true, lineIdFinance: true } } },
        },
      },
    });
    if (!payment || payment.deletedAt) {
      throw new NotFoundException('ไม่พบรายการชำระ');
    }
    if (payment.status === 'PAID') {
      throw new BadRequestException('งวดนี้ชำระครบแล้ว — ไม่ต้องปรับดิว');
    }
    if (!input.daysToShift || input.daysToShift < 1) {
      throw new BadRequestException('กรุณาระบุจำนวนวันที่เลื่อนมากกว่า 0');
    }

    // Server-authoritative quote — the SAME pure util the collect service uses.
    const lateFeeCfg = await loadLateFeeConfig(this.prisma);
    const quote = computeRescheduleQuote({
      monthlyPayment: payment.contract.monthlyPayment,
      daysToShift: input.daysToShift,
      splitMode: input.splitMode,
      payment,
      lateFeeCfg,
      now: new Date(),
    });
    if (quote.collectAmount.lte(0)) {
      throw new BadRequestException(
        'ไม่มียอดต้องเก็บ (6b + ไม่มีค่าปรับ) — ยืนยันปรับดิวได้โดยตรง ไม่ต้องส่ง QR',
      );
    }
    const collectNumber = quote.collectAmount.toDecimalPlaces(2).toNumber();

    // Single outstanding QR per installment — cancel any earlier active link
    // (both purposes: a stale partial-QR racing a reschedule-QR would double-charge).
    await this.prisma.partialPaymentLink.updateMany({
      where: { paymentId: input.paymentId, status: 'ACTIVE' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    const orderRef = String(Date.now()).slice(-12);
    const returnUrlBase =
      this.returnUrl || `${this.config.get('FRONTEND_URL', 'http://localhost:5173')}/payments`;
    const returnUrl = `${returnUrlBase}?reschedule=${payment.contract.contractNumber}`;

    const paymentPayload: Record<string, unknown> = {
      merchantId: await this.gateway.getMerchantId(),
      customerEmail: payment.contract.customer.email || 'noreply@bestchoice.com',
      referenceNo: orderRef,
      description: `ปรับดิวงวด ${payment.installmentNo} สัญญา ${payment.contract.contractNumber} (+${input.daysToShift} วัน)`,
      amount: collectNumber,
      paymentChannel: 'Qrcode',
      paymentGateway: 'Promptpay',
      currencyCode: '00',
      lang: 'TH',
      returnUrl,
      postbackUrl: `${this.apiBaseUrl}/api/paysolutions/webhook`,
      terminalId: await this.gateway.getTerminalId(),
      keyVersion: 1,
    };

    const { gatewayResponse, paymentUrl } = await this.gateway.createUiPayment(paymentPayload, {
      orderRef,
      buildErrorLog: (response, gr) =>
        `Pay Solutions reschedule-QR API error: ${response.status} ${JSON.stringify(gr)}`,
      errorMessagePrefix: 'ไม่สามารถสร้าง QR ได้',
      missingUrlMessage: 'ไม่ได้รับลิงก์ชำระเงิน',
      timeoutSentryKey: 'paysolutions-reschedule-timeout',
      timeoutSentryExtra: { paymentId: input.paymentId, amount: collectNumber },
      timeoutMessage: 'ระบบชำระเงินใช้เวลานานเกินไป',
      genericErrorMessage: 'ไม่สามารถเชื่อมต่อระบบชำระเงินได้',
    });

    try {
      const link = await this.prisma.partialPaymentLink.create({
        data: {
          paymentId: input.paymentId,
          contractId: payment.contractId,
          customerId: payment.contract.customer.id,
          token: orderRef,
          amount: collectNumber,
          gatewayRef: (gatewayResponse.refNo as string | undefined) ?? null,
          paymentUrl,
          status: 'ACTIVE',
          purpose: 'RESCHEDULE',
          metadata: {
            daysToShift: input.daysToShift,
            splitMode: input.splitMode,
            rescheduleFee: quote.rescheduleFee.toString(),
            lateFee: quote.lateFee.toString(),
            collectAmount: quote.collectAmount.toString(),
            requestedById: input.requestedById,
          },
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      this.logger.log(
        `Reschedule QR created: ${orderRef} for payment ${input.paymentId}, collect ${collectNumber} (+${input.daysToShift}d, ${quote.variant})`,
      );

      let sentToLine = false;
      const lineId = payment.contract.customer.lineIdFinance;
      if (lineId) {
        try {
          const newDue = new Date(payment.dueDate);
          newDue.setDate(newDue.getDate() + input.daysToShift);
          const newDueDateText = newDue.toLocaleDateString('th-TH', {
            day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok',
          });
          const flex = buildRescheduleQRFlex({
            customerName: payment.contract.customer.name,
            contractNumber: payment.contract.contractNumber,
            installmentNo: payment.installmentNo,
            daysToShift: input.daysToShift,
            newDueDateText,
            rescheduleFee: quote.variant === '6a' ? quote.rescheduleFee.toNumber() : 0,
            lateFee: quote.lateFee.toNumber(),
            collectAmount: collectNumber,
            paymentUrl,
            orderRef,
          });
          await this.lineOaService.pushMessage(lineId, [flex], 'line-finance');
          sentToLine = true;
          this.logger.log(
            `Reschedule Flex pushed to LINE: payment=${input.paymentId} lineId=${lineId.slice(0, 8)}...`,
          );
        } catch (pushErr) {
          this.logger.error(`Reschedule Flex push failed: ${pushErr}`);
          // swallow — cashier can resend or collect cash/transfer instead
        }
      }

      return {
        partialPaymentLinkId: link.id,
        paymentUrl,
        orderRef,
        sentToLine,
        collectAmount: quote.collectAmount.toFixed(2),
        rescheduleFee: quote.rescheduleFee.toFixed(2),
        lateFee: quote.lateFee.toFixed(2),
      };
    } catch (dbError) {
      Sentry.captureException(dbError, {
        level: 'fatal',
        tags: { critical: 'paysolutions-reschedule-orphan', orderRef },
        extra: { paymentId: input.paymentId },
      });
      throw new InternalServerErrorException('ระบบบันทึกข้อมูลชำระเงินไม่สำเร็จ');
    }
  }

  /**
   * สร้าง payment intent สำหรับ saving plan (ออมดาวน์)
   * — เรียก PaySolutions API สร้าง PromptPay QR
   * — บันทึก PaymentLink พร้อม savingPlanId
   * — Webhook จะ confirmSavingPlanPayment เมื่อชำระสำเร็จ
   */
  async createSavingPlanIntent(input: {
    savingPlanId: string;
    amount: number;
    description: string;
  }): Promise<{ paymentLinkId: string; paymentUrl: string }> {
    const plan = await this.prisma.savingPlan.findUnique({
      where: { id: input.savingPlanId },
      include: { customer: { select: { email: true, name: true } } },
    });
    if (!plan) throw new NotFoundException('ไม่พบแผนออม');

    // Numeric-only ref (see createPaymentIntent for rationale).
    const orderRef = String(Date.now()).slice(-12);
    const returnUrlBase =
      this.returnUrl || `${this.config.get('FRONTEND_URL', 'http://localhost:5174')}/saving-plan`;
    const returnUrl = `${returnUrlBase}/${plan.id}`;

    const paymentPayload: Record<string, unknown> = {
      merchantId: await this.gateway.getMerchantId(),
      customerEmail: plan.customer.email || 'noreply@bestchoice.com',
      referenceNo: orderRef,
      description: input.description,
      amount: input.amount,
      paymentChannel: 'Qrcode',
      paymentGateway: 'Promptpay',
      currencyCode: '00',
      lang: 'TH',
      returnUrl,
      postbackUrl: `${this.apiBaseUrl}/api/paysolutions/webhook`,
      terminalId: await this.gateway.getTerminalId(),
      keyVersion: 1,
    };

    const { paymentUrl } = await this.gateway.createUiPayment(paymentPayload, {
      orderRef,
      buildErrorLog: (response, gr, parsed) =>
        `Pay Solutions saving-plan API error: HTTP ${response.status} statusCode=${parsed.statusCode} message="${parsed.message}" — ${JSON.stringify(gr)}`,
      errorMessagePrefix: 'ไม่สามารถสร้างรายการชำระเงินได้',
      missingUrlMessage: 'ไม่ได้รับลิงก์ชำระเงินจากระบบ',
      timeoutSentryKey: 'paysolutions-saving-plan-timeout',
      timeoutSentryExtra: { savingPlanId: input.savingPlanId, amount: input.amount },
      timeoutMessage: 'ระบบชำระเงินใช้เวลานานเกินไป กรุณาลองใหม่',
      genericErrorMessage: 'ไม่สามารถเชื่อมต่อระบบชำระเงินได้',
    });

    try {
      const paymentLink = await this.prisma.paymentLink.create({
        data: {
          token: orderRef,
          amount: input.amount,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          savingPlanId: input.savingPlanId,
        },
      });
      this.logger.log(
        `Saving-plan payment intent: ${orderRef} for plan ${input.savingPlanId}`,
      );
      return { paymentLinkId: paymentLink.id, paymentUrl };
    } catch (dbError) {
      Sentry.captureException(dbError, {
        level: 'fatal',
        tags: { critical: 'paysolutions-saving-plan-orphan', orderRef },
        extra: { savingPlanId: input.savingPlanId },
      });
      throw new InternalServerErrorException('ระบบบันทึกข้อมูลชำระเงินไม่สำเร็จ');
    }
  }
}
