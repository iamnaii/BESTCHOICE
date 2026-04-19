import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DataAuditService } from './data-audit.service';
import { AuditFilterDto, TraceFilterDto, AuditHistoryDto } from './dto/audit-filter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Data Audit')
@ApiBearerAuth('JWT')
@Controller('data-audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
export class DataAuditController {
  constructor(private dataAuditService: DataAuditService) {}

  /** Unacknowledged FAIL findings — CRITICAL/HIGH ordered by oldest first */
  @Get('findings')
  async findings(@Query('severity') severity?: string) {
    return this.dataAuditService.getUnacknowledgedFindings(severity);
  }

  @Post('findings/:id/acknowledge')
  async acknowledge(
    @Param('id') id: string,
    @Body() body: { notes?: string },
    @CurrentUser() user: { id: string },
  ) {
    return this.dataAuditService.acknowledgeFinding(id, user.id, body?.notes);
  }

  /** Run all 12 audit checks */
  @Get('run')
  async runAll() {
    const results = await this.dataAuditService.runAllChecks();
    const passed = results.filter((r) => r.status === 'PASS').length;
    const failed = results.filter((r) => r.status === 'FAIL').length;
    const warnings = results.filter((r) => r.status === 'WARN').length;
    return {
      summary: { total: results.length, passed, failed, warnings },
      checks: results,
    };
  }

  /** Run a single audit check by name */
  @Get('check/:name')
  async runCheck(@Param('name') name: string) {
    return this.dataAuditService.runCheck(name);
  }

  /** Trace a single contract's lifecycle */
  @Get('trace-contract/:contractId')
  async traceContract(@Param('contractId') contractId: string) {
    return this.dataAuditService.traceContract(contractId);
  }

  /** Trace all contracts matching filters */
  @Get('trace-all')
  async traceAll(@Query() filters: TraceFilterDto) {
    return this.dataAuditService.traceAll(filters);
  }

  /** View audit history */
  @Get('history')
  async history(@Query() filters: AuditHistoryDto) {
    return this.dataAuditService.getHistory(filters);
  }

  /** Dry-run: preview what backfill would create (no DB changes) */
  @Get('backfill/dry-run')
  async backfillDryRun(@Query('limit') limit?: string) {
    return this.dataAuditService.backfillJournals({
      dryRun: true,
      limit: limit ? parseInt(limit, 10) : 100,
    });
  }

  /** Execute backfill: create missing journals for legacy contracts */
  @Post('backfill/execute')
  async backfillExecute(@Query('limit') limit?: string) {
    return this.dataAuditService.backfillJournals({
      dryRun: false,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }
}
