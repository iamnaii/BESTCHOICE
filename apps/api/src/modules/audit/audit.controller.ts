import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Audit')
@ApiBearerAuth('JWT')
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get('financial/:contractId')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  getFinancialTrail(
    @Param('contractId') contractId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.getFinancialAuditTrail(contractId, {
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('logs')
  @Roles('OWNER', 'VIEWER')
  getLogs(
    @Query('userId') userId?: string,
    @Query('entity') entity?: string,
    @Query('action') action?: string,
    @Query('actions') actions?: string | string[],
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('entityId') entityId?: string,
  ) {
    // Accept ?actions=A&actions=B (array) or ?actions=A,B (CSV)
    let actionsList: string[] | undefined;
    if (Array.isArray(actions)) {
      actionsList = actions.filter((a) => typeof a === 'string' && a.length > 0);
    } else if (typeof actions === 'string' && actions.length > 0) {
      actionsList = actions.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return this.auditService.getAuditLogs({
      userId,
      entity,
      action,
      actions: actionsList && actionsList.length > 0 ? actionsList : undefined,
      from,
      to,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      search,
      entityId,
    });
  }

  @Get('stats')
  @Roles('OWNER', 'VIEWER')
  getStats() {
    return this.auditService.getAuditStats();
  }

  /**
   * T2-C4 ext: walk the Merkle hash chain over AuditLog and return
   * ok/first-mismatch. OWNER + VIEWER (external auditor, gated by
   * `viewer_role_enabled` SystemConfig per Owner Q4 2026-05-17) — both
   * roles need chain-integrity verification, and the response surface
   * (ok / rowsChecked / firstMismatchSeq / firstMismatchId) is what an
   * auditor needs to certify the log.
   */
  @Get('verify-chain')
  @Roles('OWNER', 'VIEWER')
  async verifyChain() {
    const result = await this.auditService.verifyChain({ maxRows: 50_000 });
    return {
      ok: result.ok,
      rowsChecked: result.rowsChecked,
      firstMismatchSeq: result.firstMismatchSeq?.toString() ?? null,
      firstMismatchId: result.firstMismatchId,
    };
  }
}
