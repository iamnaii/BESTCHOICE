import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  HttpCode,
  Logger,
  BadRequestException,
  RawBodyRequest,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { PaySolutionsService } from './paysolutions.service';
import { CreatePaymentIntentDto } from './dto';

/**
 * PaySolutions Payment Gateway Controller
 *
 * NOTE: ไม่ใช้ JwtAuthGuard ที่ class level เพราะ webhook endpoint ต้องเป็น public
 * Endpoints ที่ต้อง auth จะใส่ guard เฉพาะ method
 */
@Controller('paysolutions')
export class PaySolutionsController {
  private readonly logger = new Logger(PaySolutionsController.name);

  constructor(private readonly paySolutionsService: PaySolutionsService) {}

  /**
   * POST /api/paysolutions/create-intent
   * สร้าง payment intent — ส่งไป Pay Solutions, ได้ payment URL กลับมา
   * ใช้จาก LIFF (ไม่ต้อง JWT — ใช้ lineId verify แทน)
   */
  @Post('create-intent')
  @SkipCsrf()
  @Throttle({ short: { ttl: 10000, limit: 5 } })
  async createPaymentIntent(@Body() dto: CreatePaymentIntentDto) {
    if (!dto.contractId || !dto.amount) {
      throw new BadRequestException('กรุณาระบุรหัสสัญญาและจำนวนเงิน');
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
   * Verify signature แทน JWT
   */
  @Post('webhook')
  @SkipCsrf()
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: Record<string, string>,
  ) {
    this.logger.log(`Webhook received: ${JSON.stringify(body)}`);

    // Verify webhook signature
    const signature = req.headers['x-signature'] as string || req.headers['x-paysolutions-signature'] as string || '';
    const rawBody = req.rawBody?.toString() || JSON.stringify(body);

    if (signature) {
      const isValid = this.paySolutionsService.verifyWebhookSignature(rawBody, signature);
      if (!isValid) {
        this.logger.warn('Invalid webhook signature');
        // Return 200 anyway to prevent retries, but don't process
        return { received: true, processed: false };
      }
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
   * ดึงสถานะ payment สำหรับ frontend polling
   * ไม่ต้อง auth — LIFF เรียกใช้
   */
  @Get('status/:paymentId')
  @SkipCsrf()
  async getPaymentStatus(@Param('paymentId') paymentId: string) {
    const status = await this.paySolutionsService.getPaymentStatus(paymentId);
    return status;
  }
}
