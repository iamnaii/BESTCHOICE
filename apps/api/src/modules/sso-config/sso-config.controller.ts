import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SsoConfigService, SSO_RATE } from './sso-config.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('sso-config')
export class SsoConfigController {
  constructor(private readonly ssoConfig: SsoConfigService) {}

  /**
   * Period-effective SSO contribution config (ceiling + cap + rate) for a date.
   * Used by the payroll form to pre-fill SSO = round2(min(base, ceiling) × rate).
   * Roles mirror the payroll-create endpoint.
   */
  @Get('effective')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async effective(@Query('date') date?: string) {
    const when = date ? new Date(date) : new Date();
    if (Number.isNaN(when.getTime())) {
      throw new BadRequestException('รูปแบบวันที่ไม่ถูกต้อง (เช่น 2026-06-01)');
    }
    const cfg = await this.ssoConfig.getEffectiveConfig(when);
    return {
      salaryCeiling: cfg.salaryCeiling, // Prisma.Decimal → JSON string
      maxContribution: cfg.maxContribution, // Prisma.Decimal → JSON string
      effectiveFrom: cfg.effectiveFrom,
      rate: SSO_RATE,
    };
  }
}
