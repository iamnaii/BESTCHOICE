import { Body, Controller, Get, HttpCode, Logger, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { VerificationService } from './services/verification.service';
import { FeedbackService } from './services/feedback.service';
import { LiffTokenGuard, LiffRequest } from '../line-oa/guards/liff-token.guard';

class RequestOtpDto {
  @IsString()
  @Matches(/^[0-9-\s]+$/, { message: 'เบอร์โทรไม่ถูกต้อง' })
  phone!: string;
}

class VerifyOtpDto {
  @IsString()
  @Length(6, 6, { message: 'OTP ต้องเป็นตัวเลข 6 หลัก' })
  otp!: string;
}

class SubmitFeedbackDto {
  @IsString()
  sessionId!: string;

  @IsOptional()
  @IsString()
  messageId?: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  rating!: number; // 0=👎, 1=👍

  @IsOptional()
  @IsString()
  feedbackText?: string;
}

/**
 * LIFF endpoints สำหรับ Finance Bot verification
 *
 * Protected by LiffTokenGuard — verify LINE ID token server-side.
 * lineUserId มาจาก request.liffUserId (verified by LINE API).
 *
 * Routes:
 *   GET  /api/chatbot/finance/liff/status     ← เช็คว่า link แล้วไหม
 *   POST /api/chatbot/finance/liff/request-otp ← ส่ง SMS OTP
 *   POST /api/chatbot/finance/liff/verify-otp  ← verify + bind
 *   POST /api/chatbot/finance/liff/feedback     ← 👍/👎 feedback
 */
@Controller('chatbot/finance/liff')
@SkipCsrf()
@UseGuards(LiffTokenGuard)
export class ChatbotFinanceLiffController {
  private readonly logger = new Logger(ChatbotFinanceLiffController.name);

  constructor(
    private verification: VerificationService,
    private feedback: FeedbackService,
  ) {}

  @Get('status')
  @Throttle({ short: { ttl: 60000, limit: 30 } }) // 30/นาที — เผื่อ LIFF page mount หลายครั้ง
  async status(@Req() req: LiffRequest) {
    const lineUserId = req.liffUserId;
    if (!lineUserId) {
      return { linked: false };
    }
    return this.verification.isLinked(lineUserId);
  }

  @Post('request-otp')
  @HttpCode(200)
  @Throttle({ short: { ttl: 60000, limit: 5 } }) // 5/นาที/IP — ป้องกัน OTP spam + phone enumeration
  async requestOtp(@Req() req: LiffRequest, @Body() dto: RequestOtpDto) {
    this.logger.log(`[LIFF] OTP requested`);
    return this.verification.requestOtp({
      lineUserId: req.liffUserId,
      phone: dto.phone,
    });
  }

  @Post('verify-otp')
  @HttpCode(200)
  @Throttle({ short: { ttl: 60000, limit: 10 } }) // 10/นาที/IP — เผื่อพิมพ์ผิด
  async verifyOtp(@Req() req: LiffRequest, @Body() dto: VerifyOtpDto) {
    const result = await this.verification.verifyOtp({
      lineUserId: req.liffUserId,
      otp: dto.otp,
    });
    this.logger.log(`[LIFF] Verified successfully`);
    return result;
  }

  @Post('feedback')
  @HttpCode(200)
  @Throttle({ short: { ttl: 60000, limit: 10 } })
  async submitFeedback(@Req() req: LiffRequest, @Body() dto: SubmitFeedbackDto) {
    return this.feedback.saveFeedback({
      lineUserId: req.liffUserId,
      sessionId: dto.sessionId,
      messageId: dto.messageId,
      rating: dto.rating,
      feedbackText: dto.feedbackText,
    });
  }
}
