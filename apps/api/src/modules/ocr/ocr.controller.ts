import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OcrService } from './ocr.service';
import { OcrIdCardDto } from './dto/ocr.dto';
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
}
