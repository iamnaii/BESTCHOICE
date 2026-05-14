import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  Logger,
  BadRequestException,
  ParseUUIDPipe,
  Req,
  Headers,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'crypto';
import * as Sentry from '@sentry/nestjs';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { PaySolutionsService } from './paysolutions.service';
import { CreatePaymentIntentDto } from './dto';
import { LiffTokenGuard } from '../line-oa/guards/liff-token.guard';
import { WebhookAnomalyService } from '../webhook-security/webhook-anomaly.service';
import { RawBodyRequest } from '../../common/types/raw-body-request';

/**
 * PaySolutions Payment Gateway Controller
 *
 * NOTE: ไม่ใช้ JwtAuthGuard ที่ class level เพราะ webhook endpoint ต้องเป็น public
 * Endpoints ที่ต้อง auth จะใส่ guard เฉพาะ method
 */
@ApiTags('Payments')
@ApiBearerAuth('JWT')
@Controller('paysolutions')
export class PaySolutionsController {
  private readonly logger = new Logger(PaySolutionsController.name);

  constructor(
    private readonly paySolutionsService: PaySolutionsService,
    private readonly anomaly: WebhookAnomalyService,
  ) {}

  /**
   * POST /api/paysolutions/create-intent
   * สร้าง payment intent — ส่งไป Pay Solutions, ได้ payment URL กลับมา
   * ใช้จาก LIFF — ต้องมี X-Liff-Id-Token header (verified ด้วย LINE API)
   */
  @Post('create-intent')
  @SkipCsrf()
  @UseGuards(LiffTokenGuard)
  @Throttle({ short: { ttl: 10000, limit: 5 } })
  async createPaymentIntent(@Body() dto: CreatePaymentIntentDto) {
    if (!dto.contractId || !dto.amount) {
      throw new BadRequestException('กรุณาระบุรหัสสัญญาและจำนวนเงิน');
    }
    if (!dto.lineId) {
      throw new BadRequestException('กรุณาระบุ LINE ID เพื่อยืนยันตัวตน');
    }

    const result = await this.paySolutionsService.createPaymentIntent(
      dto.contractId,
      dto.amount,
      dto.description,
      dto.lineId,
      dto.installmentNo,
    );

    return {
      success: true,
      paymentId: result.paymentId,
      paymentUrl: result.paymentUrl,
      gatewayRef: result.gatewayRef,
      qrCodeUrl: result.qrCodeUrl,
    };
  }

  /**
   * POST /api/paysolutions/webhook
   * Webhook callback จาก Pay Solutions — ไม่มี auth guard
   *
   * Defense-in-depth:
   *   1. Throttle per merchantId (60/min) — prevents a single bad
   *      merchant from drowning the endpoint
   *   2. HMAC-SHA256 (optional) — if PAYSOLUTIONS_WEBHOOK_SECRET is set,
   *      verify X-PaySolutions-Signature header using timingSafeEqual.
   *      If not set, log a warning and fall through to merchantId check
   *      (backward-compat with provider configs that haven't enabled
   *      signing yet).
   *   3. merchantId match — final gate; rejects webhooks with wrong
   *      merchantId even when HMAC is off.
   */
  @Post('webhook')
  @SkipCsrf()
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async handleWebhook(
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Headers('x-paysolutions-signature') signature: string | undefined,
  ) {
    // PII-safe log: only fields needed to trace a webhook in support
    // tickets. Customer email/phone/name are NOT in the v2 webhook
    // payload but we still want a positive allow-list to prevent
    // future PaySolutions API changes from leaking data into our logs.
    const safeFields = {
      refno: body.refno,
      result_code: body.result_code,
      order_no: body.order_no,
      transaction_id: body.transaction_id,
      total: body.total,
    };
    this.logger.log(`Webhook received: ${JSON.stringify(safeFields)}`);

    // 1. HMAC-SHA256 verification.
    // (Audit finding P0-#7) In production the secret is mandatory — without
    // it the merchantId-only fallback below allows anyone who can guess the
    // public merchantId to forge a webhook and credit a payment. Reject
    // outright in prod when the env is missing rather than skipping the
    // check.
    const webhookSecret = process.env.PAYSOLUTIONS_WEBHOOK_SECRET;
    if (!webhookSecret) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          '[PaySolutions] PAYSOLUTIONS_WEBHOOK_SECRET not set in production — rejecting webhook',
        );
        return { received: true, processed: false };
      }
      this.logger.warn(
        '[PaySolutions] PAYSOLUTIONS_WEBHOOK_SECRET not set — skipping HMAC verification (dev only)',
      );
    } else {
      const rawBody = (req as unknown as RawBodyRequest).rawBody;
      if (!this.verifyPaySolutionsSignature(rawBody, signature, webhookSecret)) {
        this.logger.warn('[PaySolutions] HMAC signature mismatch — rejecting webhook');
        void this.anomaly.record({
          provider: 'paysolutions',
          reason: signature ? 'invalid_signature' : 'missing_signature',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] as string | undefined,
          meta: { refno: body.refno, order_no: body.order_no },
        });
        return { received: true, processed: false };
      }
    }

    // 2. Verify merchantid ตรงกับ config
    const isValid = await this.paySolutionsService.verifyWebhookMerchant(body.merchantid || '');
    if (!isValid) {
      this.logger.warn('Invalid webhook merchantid');
      void this.anomaly.record({
        provider: 'paysolutions',
        reason: 'merchant_mismatch',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
        meta: { refno: body.refno, order_no: body.order_no },
      });
      return { received: true, processed: false };
    }

    // 3. Process payment callback.
    //
    // Round 2 Critical #1 fix: the underlying $transaction in
    // `handlePaymentCallback` now wraps Payment.update + JE post in
    // serializable isolation and propagates exceptions on JE failure. We
    // must MAKE failures VISIBLE in Sentry — silently swallowing them would
    // hide permanent-fail cases (customer paid, no JE, paymentLink stuck
    // ACTIVE forever) because PaySolutions caps retries at 3.
    //
    // Strategy: capture to Sentry with explicit module/action tags, then
    // re-throw so PaySolutions enqueues a retry (their 3-retry policy is
    // our last automatic chance before manual reconciliation).
    //
    // Alerting runbook: set a Sentry alert on
    //   tags.module = "paysolutions" AND tags.action = "payment_callback_je_failure"
    // → page on-call after the 3rd retry exhausts (any single capture with
    // refno + transaction_id that doesn't auto-resolve in 30 min).
    try {
      await this.paySolutionsService.handlePaymentCallback(body);
    } catch (error) {
      this.logger.error(`Webhook processing error: ${error}`);
      Sentry.captureException(error, {
        tags: {
          module: 'paysolutions',
          action: 'payment_callback_je_failure',
        },
        extra: {
          refno: body.refno,
          merchantid: body.merchantid,
          order_no: body.order_no,
          transaction_id: body.transaction_id,
          result_code: body.result_code,
          total: body.total,
        },
      });
      // Re-throw so PaySolutions retries (max 3). NestJS default exception
      // filter converts to 500 — webhook caller treats as retriable. After
      // 3 retries the Sentry alert is the manual-reconciliation signal.
      throw error;
    }

    return { received: true, processed: true };
  }

  /**
   * Verify PaySolutions webhook HMAC-SHA256 signature using raw request bytes.
   * PaySolutions' exact signing scheme is not published; we assume the common
   * convention of HMAC-SHA256(rawBody, secret) returned as hex. The header
   * may be prefixed with 'sha256=' — accept both shapes.
   */
  private verifyPaySolutionsSignature(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    secret: string,
  ): boolean {
    if (!rawBody || !signature) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const received = signature.startsWith('sha256=') ? signature.slice(7) : signature;
    try {
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(received, 'hex');
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /**
   * GET /api/paysolutions/status/:paymentId
   * ดึงสถานะ payment สำหรับ LIFF polling (public endpoint — ไม่ต้อง JWT)
   * ป้องกันด้วย: UUID validation + rate limit 30 req/min per IP
   * ข้อมูลที่ return ไม่มี PII — มีเฉพาะ status/amount/paidAt
   */
  @Get('status/:paymentId')
  @SkipCsrf()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getPaymentStatus(@Param('paymentId', new ParseUUIDPipe({ errorHttpStatusCode: 400 })) paymentId: string) {
    const status = await this.paySolutionsService.getPaymentStatus(paymentId);
    return status;
  }
}
