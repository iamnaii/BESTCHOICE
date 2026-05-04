import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { JournalService } from './journal.service';
import { CreateJournalEntryDto } from './dto/journal.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Journal Entries')
@ApiBearerAuth('JWT')
@Controller('journal-entries')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class JournalController {
  constructor(
    private journalService: JournalService,
  ) {}

  // NOTE: trial-balance endpoint removed from this controller.
  // Use GET /accounting/trial-balance (AccountingService.getTrialBalance) instead.

  @Post()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  create(@Body() dto: CreateJournalEntryDto, @CurrentUser('id') userId: string) {
    return this.journalService.create(dto, userId);
  }

  @Get()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.journalService.findAll({
      companyId,
      status,
      startDate,
      endDate,
      search,
      page: page ? parseInt(page) : undefined,
      limit: limit ? Math.min(parseInt(limit) || 50, 100) : undefined,
    });
  }

  @Get(':id')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.journalService.findOne(id);
  }

  @Post(':id/post')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  post(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    // T2-C14 — capture ip + UA at the controller edge. JournalPostAuditLog
    // is the "who POSTED what, from where" legal-retention trail.
    const ipAddress =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
      req.ip ||
      undefined;
    const userAgent = req.headers['user-agent'] ?? undefined;
    return this.journalService.post(id, userId, { ipAddress, userAgent });
  }

  @Post(':id/void')
  @Roles('OWNER')
  void(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.journalService.void(id, userId);
  }
}
