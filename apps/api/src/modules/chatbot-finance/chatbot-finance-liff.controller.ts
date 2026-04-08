import { Body, Controller, Get, HttpCode, Logger, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length, Matches } from 'class-validator';
import { VerificationService } from './services/verification.service';

class RequestOtpDto {
  @IsString()
  lineUserId!: string;

  @IsString()
  @Matches(/^[0-9-\s]+$/, { message: 'เบอร์โทรไม่ถูกต้อง' })
  phone!: string;
}

class VerifyOtpDto {
  @IsString()
  lineUserId!: string;

  @IsString()
  @Length(6, 6, { message: 'OTP ต้องเป็นตัวเลข 6 หลัก' })
  otp!: string;
}

/**
 * LIFF endpoints สำหรับ Finance Bot verification
 *
 * Public endpoints (no JWT) — protection ผ่าน:
 *   - LINE LIFF userId ที่ได้จาก liff.getProfile() (มาจาก trusted LINE)
 *   - SMS OTP (factor 2)
 *   - Rate limit (ที่ระดับ ThrottlerGuard global)
 *
 * Routes:
 *   GET  /api/chatbot/finance/liff/status?lineUserId=...   ← เช็คว่า link แล้วไหม
 *   POST /api/chatbot/finance/liff/request-otp             ← ส่ง SMS OTP
 *   POST /api/chatbot/finance/liff/verify-otp              ← verify + bind
 */
@Controller('chatbot/finance/liff')
export class ChatbotFinanceLiffController {
  private readonly logger = new Logger(ChatbotFinanceLiffController.name);

  constructor(private verification: VerificationService) {}

  @Get('status')
  @Throttle({ short: { ttl: 60000, limit: 30 } }) // 30/นาที — เผื่อ LIFF page mount หลายครั้ง
  async status(@Query('lineUserId') lineUserId: string) {
    if (!lineUserId) {
      return { linked: false };
    }
    return this.verification.isLinked(lineUserId);
  }

  @Post('request-otp')
  @HttpCode(200)
  @Throttle({ short: { ttl: 60000, limit: 5 } }) // 5/นาที/IP — ป้องกัน OTP spam + phone enumeration
  async requestOtp(@Body() dto: RequestOtpDto) {
    this.logger.log(`[LIFF] OTP requested`);
    return this.verification.requestOtp({
      lineUserId: dto.lineUserId,
      phone: dto.phone,
    });
  }

  @Post('verify-otp')
  @HttpCode(200)
  @Throttle({ short: { ttl: 60000, limit: 10 } }) // 10/นาที/IP — เผื่อพิมพ์ผิด
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    const result = await this.verification.verifyOtp({
      lineUserId: dto.lineUserId,
      otp: dto.otp,
    });
    this.logger.log(`[LIFF] Verified successfully`);
    return result;
  }
}
