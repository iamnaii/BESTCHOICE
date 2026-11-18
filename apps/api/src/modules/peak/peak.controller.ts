import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { PeakService } from './peak.service';
import { ExportJournalEntriesDto } from './dto/peak.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { reportAsOf, reportDayStart } from '../../utils/date.util';

@Controller('peak')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class PeakController {
  constructor(private peakService: PeakService) {}

  @Get('status')
  @Roles('OWNER')
  async getStatus() {
    return this.peakService.getStatus();
  }

  @Post('export')
  @Roles('OWNER')
  async exportEntries(@Body() dto: ExportJournalEntriesDto) {
    // reportAsOf: YYYY-MM-DD = สิ้นวันไทย · ค่าอื่นคงตามที่ส่งมา (เดิมไม่ขยายเป็นสิ้นวัน)
    return this.peakService.exportJournalEntries(reportDayStart(dto.startDate), reportAsOf(dto.endDate));
  }

  @Get('account-codes')
  @Roles('OWNER', 'ACCOUNTANT')
  async getAccountCodes() {
    return this.peakService.getAccountCodes();
  }
}
