import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PeakService } from './peak.service';
import { ExportJournalEntriesDto } from './dto/peak.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('PEAK Accounting Sync')
@ApiBearerAuth('JWT')
@Controller('peak')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class PeakController {
  constructor(private peakService: PeakService) {}

  @Get('status')
  @Roles('OWNER')
  @ApiOperation({ summary: 'ตรวจสอบสถานะการเชื่อมต่อ PEAK' })
  getStatus() {
    const configured = this.peakService.isConfigured();
    return {
      configured,
      message: configured ? 'PEAK connected' : 'ยังไม่ได้ตั้งค่า PEAK API',
    };
  }

  @Post('export')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Export journal entries ไปยัง PEAK ตามช่วงวันที่' })
  async exportEntries(@Body() dto: ExportJournalEntriesDto) {
    return this.peakService.exportJournalEntries(new Date(dto.startDate), new Date(dto.endDate));
  }
}
