import { Controller, Post, Get, Param, Body, UseGuards, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { KycService } from './kyc.service';
import { SendOtpDto, VerifyOtpDto, UploadIdCardDto } from './dto/kyc.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('contracts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KycController {
  constructor(private kycService: KycService) {}

  @Post(':id/kyc/send-otp')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  sendOtp(
    @Param('id') id: string,
    @Body() dto: SendOtpDto,
    @Req() req: any,
  ) {
    return this.kycService.sendOtp(id, dto.channel, {
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Post(':id/kyc/verify-otp')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  verifyOtp(
    @Param('id') id: string,
    @Body() dto: VerifyOtpDto,
  ) {
    return this.kycService.verifyOtp(id, dto.otp);
  }

  @Post(':id/kyc/upload-id-card')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  uploadIdCard(
    @Param('id') id: string,
    @Body() dto: UploadIdCardDto,
    @Req() req: any,
  ) {
    return this.kycService.uploadIdCard(id, dto.imageBase64, {
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Get(':id/kyc/status')
  getStatus(@Param('id') id: string) {
    return this.kycService.getStatus(id);
  }
}
