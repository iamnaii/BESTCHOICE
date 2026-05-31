import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FinanceReceivableContactLogsService } from './finance-receivable-contact-logs.service';
import {
  CreateFinanceContactLogDto,
  UpdateFinanceContactLogDto,
} from './dto/finance-receivable-contact-log.dto';

@ApiTags('Finance Contact Logs')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class FinanceReceivableContactLogsController {
  constructor(private readonly service: FinanceReceivableContactLogsService) {}

  @Get('finance-receivable/:receivableId/contact-logs')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list(@Param('receivableId') receivableId: string) {
    return this.service.list(receivableId);
  }

  @Post('finance-receivable/:receivableId/contact-logs')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  record(
    @Param('receivableId') receivableId: string,
    @Body() dto: CreateFinanceContactLogDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.service.record(receivableId, req.user.id, dto);
  }

  @Patch('finance-receivable/:receivableId/contact-logs/:logId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  update(
    @Param('receivableId') receivableId: string,
    @Param('logId') logId: string,
    @Body() dto: UpdateFinanceContactLogDto,
    @Request() req: { user: { id: string; role: string } },
  ) {
    return this.service.update(receivableId, logId, req.user.id, req.user.role, dto);
  }

  @Delete('finance-receivable/:receivableId/contact-logs/:logId')
  @Roles('OWNER', 'FINANCE_MANAGER')
  remove(
    @Param('receivableId') receivableId: string,
    @Param('logId') logId: string,
  ) {
    return this.service.softDelete(receivableId, logId);
  }

  @Get('external-finance/companies/:companyId/contact-summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  summary(@Param('companyId') companyId: string) {
    return this.service.companyContactSummary(companyId);
  }

  @Get('external-finance/companies/:companyId/contact-logs')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  companyLogs(
    @Param('companyId') companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.companyContactLogs(
      companyId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }
}
