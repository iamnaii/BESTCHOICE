import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { OcrService } from './ocr.service';
import { OcrIdCardDto } from './dto/ocr.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('ocr')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OcrController {
  constructor(private ocrService: OcrService) {}

  @Post('id-card')
  @SkipThrottle()
  extractIdCard(@Body() dto: OcrIdCardDto) {
    return this.ocrService.extractIdCard(dto.imageBase64);
  }
}
