import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ConsolidatedService } from './consolidated.service';

/**
 * SP7.6 — Consolidated cross-entity reports for OWNER + ACCOUNTANT.
 * Aggregates SHOP + FINANCE data with intercompany eliminations.
 */
@Controller('accounting/consolidated')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'ACCOUNTANT', 'VIEWER')
export class ConsolidatedController {
  constructor(private readonly svc: ConsolidatedService) {}

  /**
   * GET /accounting/consolidated/trial-balance?asOf=2026-05-19
   * Combined SHOP+FINANCE trial balance as of a given date.
   */
  @Get('trial-balance')
  trialBalance(@Query('asOf') asOf?: string) {
    return this.svc.getConsolidatedTrialBalance(asOf ? new Date(asOf) : undefined);
  }

  /**
   * GET /accounting/consolidated/profit-loss?start=2026-01-01&end=2026-12-31
   * Consolidated P&L with intercompany eliminations.
   */
  @Get('profit-loss')
  profitLoss(@Query('start') start: string, @Query('end') end: string) {
    return this.svc.getConsolidatedProfitLoss(new Date(start), new Date(end));
  }

  /**
   * GET /accounting/consolidated/dashboard?asOf=2026-05-19
   * MTD KPIs per entity + consolidated net (current month by default).
   */
  @Get('dashboard')
  dashboard(@Query('asOf') asOf?: string) {
    return this.svc.getConsolidatedDashboard(asOf ? new Date(asOf) : undefined);
  }
}
