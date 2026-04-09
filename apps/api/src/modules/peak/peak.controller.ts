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

@Controller('peak')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class PeakController {
  constructor(private peakService: PeakService) {}

  @Get('status')
  @Roles('OWNER')
  getStatus() {
    return this.peakService.getStatus();
  }

  @Post('export')
  @Roles('OWNER')
  async exportEntries(@Body() dto: ExportJournalEntriesDto) {
    return this.peakService.exportJournalEntries(new Date(dto.startDate), new Date(dto.endDate));
  }

  @Get('account-codes')
  @Roles('OWNER', 'ACCOUNTANT')
  async getAccountCodes() {
    return this.peakService.getAccountCodes();
  }
}
