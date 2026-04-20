import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { TwoFactorService } from './two-factor.service';
import { Confirm2faDto } from './dto/confirm-2fa.dto';
import { Disable2faDto } from './dto/disable-2fa.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('2FA Management')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('2fa')
export class TwoFactorController {
  constructor(private readonly twoFactorService: TwoFactorService) {}

  @Post('enroll')
  @Throttle({ short: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'เริ่มกระบวนการเปิดใช้ 2FA (รับ QR code)' })
  async startEnrollment(@CurrentUser('id') userId: string) {
    return this.twoFactorService.startEnrollment(userId);
  }

  @Post('confirm')
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'ยืนยัน OTP เพื่อเปิดใช้ 2FA + รับ backup codes' })
  async confirmEnrollment(
    @CurrentUser('id') userId: string,
    @Body() dto: Confirm2faDto,
  ) {
    return this.twoFactorService.confirmEnrollment(userId, dto.token);
  }

  @Post('disable')
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'ปิดใช้ 2FA (ยืนยันด้วย OTP หรือ backup code)' })
  async disable(
    @CurrentUser('id') userId: string,
    @Body() dto: Disable2faDto,
  ) {
    return this.twoFactorService.disable(userId, dto.currentToken);
  }

  @Post('backup-codes')
  @Throttle({ short: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'สร้าง backup codes ใหม่ (ต้องยืนยันด้วย OTP ก่อน)' })
  async regenerateBackupCodes(
    @CurrentUser('id') userId: string,
    @Body() dto: Confirm2faDto,
  ) {
    return this.twoFactorService.regenerateBackupCodes(userId, dto.token);
  }
}
