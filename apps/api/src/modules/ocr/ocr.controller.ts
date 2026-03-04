import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OcrService } from './ocr.service';
import {
  OcrIdCardDto,
  OcrPaymentSlipDto,
  OcrBookBankDto,
  OcrDrivingLicenseDto,
} from './dto/ocr.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@Controller('ocr')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OcrController {
  constructor(private ocrService: OcrService) {}

  @Post('id-card')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  extractIdCard(@Body() dto: OcrIdCardDto) {
    return this.ocrService.extractIdCard(dto.imageBase64);
  }

  @Post('payment-slip')
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  extractPaymentSlip(@Body() dto: OcrPaymentSlipDto) {
    return this.ocrService.extractPaymentSlip(dto.imageBase64);
  }

  @Post('book-bank')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  extractBookBank(@Body() dto: OcrBookBankDto) {
    return this.ocrService.extractBookBank(dto.imageBase64);
  }

  @Post('driving-license')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  extractDrivingLicense(@Body() dto: OcrDrivingLicenseDto) {
    return this.ocrService.extractDrivingLicense(dto.imageBase64);
  }
}
