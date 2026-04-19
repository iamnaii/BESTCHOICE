import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JournalService } from './journal.service';
import { JournalAutoService } from './journal-auto.service';
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
    private journalAutoService: JournalAutoService,
  ) {}

  @Get('trial-balance')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getTrialBalance(
    @Query('asOfDate') asOfDate?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.journalAutoService.getTrialBalance({ asOfDate, companyId });
  }

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
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get(':id')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.journalService.findOne(id);
  }

  @Post(':id/post')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  post(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.journalService.post(id, userId);
  }

  @Post(':id/void')
  @Roles('OWNER')
  void(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.journalService.void(id, userId);
  }
}
