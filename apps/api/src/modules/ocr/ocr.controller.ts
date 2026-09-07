import { Controller, Post, Body, UseGuards, Req, BadRequestException } from '@nestjs/common';
import { CreditRoomActor, RoomCreditService } from '../credit-check/services/room-credit.service';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OcrService } from './ocr.service';
import {
  OcrIdCardDto,
  OcrPaymentSlipDto,
  OcrBookBankDto,
  OcrDrivingLicenseDto,
  OcrSalarySlipDto,
  OcrBankStatementDto,
} from './dto/ocr.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('OCR')
@ApiBearerAuth('JWT')
@Controller('ocr')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OcrController {
  constructor(private ocrService: OcrService, private roomCredit: RoomCreditService) {}

  @Post('id-card')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  extractIdCard(@Body() dto: OcrIdCardDto) {
    return this.ocrService.extractIdCard(dto.imageBase64);
  }

  @Post('payment-slip')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  extractPaymentSlip(@Body() dto: OcrPaymentSlipDto) {
    return this.ocrService.extractPaymentSlip(dto.imageBase64);
  }

  @Post('book-bank')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  extractBookBank(@Body() dto: OcrBookBankDto) {
    return this.ocrService.extractBookBank(dto.imageBase64);
  }

  @Post('driving-license')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  extractDrivingLicense(@Body() dto: OcrDrivingLicenseDto) {
    return this.ocrService.extractDrivingLicense(dto.imageBase64);
  }

  @Post('salary-slip')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  analyzeSalarySlip(@Body() dto: OcrSalarySlipDto) {
    return this.ocrService.analyzeSalarySlip(dto.imageBase64);
  }

  @Post('bank-statement')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  analyzeBankStatement(@Body() dto: OcrBankStatementDto, @Req() req: { user: CreditRoomActor }) {
    if (dto.roomId) {
      if (dto.filesBase64 !== undefined) throw new BadRequestException('กรุณาเลือกรายการไฟล์จากห้องแชทเท่านั้น');
      return this.roomCredit.analyze(dto.roomId, dto.fileIds!, req.user);
    }
    return this.ocrService.analyzeBankStatement(dto.filesBase64);
  }
}
