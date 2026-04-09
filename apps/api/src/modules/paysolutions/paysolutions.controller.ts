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
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { PaySolutionsService } from './paysolutions.service';
import { CreatePaymentIntentDto } from './dto';

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

  constructor(private readonly paySolutionsService: PaySolutionsService) {}

  /**
   * POST /api/paysolutions/create-intent
   * สร้าง payment intent — ส่งไป Pay Solutions, ได้ payment URL กลับมา
   * ใช้จาก LIFF (ไม่ต้อง JWT — ใช้ lineId verify ตัวตนแทน)
   */
  @Post('create-intent')
  @SkipCsrf()
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
   * Pay Solutions ส่ง form POST พร้อม parameters กลับมา ตรวจ merchantid แทน signature
   */
  @Post('webhook')
  @SkipCsrf()
  @HttpCode(200)
  async handleWebhook(@Body() body: Record<string, string>) {
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

    // Verify merchantid ตรงกับ config
    const isValid = this.paySolutionsService.verifyWebhookMerchant(body.merchantid || '');
    if (!isValid) {
      this.logger.warn('Invalid webhook merchantid');
      return { received: true, processed: false };
    }

    // Process payment callback
    try {
      await this.paySolutionsService.handlePaymentCallback(body);
    } catch (error) {
      this.logger.error(`Webhook processing error: ${error}`);
      // Still return 200 — webhook received, processing failed
    }

    return { received: true, processed: true };
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
