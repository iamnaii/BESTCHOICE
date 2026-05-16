import { Controller, Get, Patch, Put, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { BulkUpdateSettingsDto } from './dto/update-settings.dto';
import { CollectionsConfigDto } from './dto/collections-config.dto';
import { AssignPettyCashCustodianDto } from './dto/petty-cash-custodian.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Settings')
@ApiBearerAuth('JWT')
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get()
  findAll() {
    return this.settingsService.findAll();
  }

  /**
   * D1.* — UI feature flags read by web app for non-OWNER users (payroll
   * editors, accountants etc.). Authenticated but NOT @Roles-gated so the
   * web app can fetch them in any role context.
   */
  @Get('ui-flags')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  getUiFlags() {
    return this.settingsService.getUiFlags();
  }

  @Patch()
  bulkUpdate(@Body() dto: BulkUpdateSettingsDto, @CurrentUser() user: { id: string }) {
    return this.settingsService.bulkUpdate(dto.items, user.id);
  }

  @Get('collections')
  getCollectionsConfig() {
    return this.settingsService.getCollectionsConfig();
  }

  @Put('collections')
  async updateCollectionsConfig(
    @Body() dto: CollectionsConfigDto,
    @CurrentUser() user: { id: string },
  ) {
    // Reuse existing bulkUpdate plumbing so audit log + cache invalidation
    // continue to flow through the same path as the generic Patch endpoint.
    await this.settingsService.bulkUpdate(
      [
        { key: 'collections.dailyCap', value: String(dto.dailyCap) },
        { key: 'collections.workloadFloor', value: String(dto.workloadFloor) },
        { key: 'collections.etaPerContractMin', value: String(dto.etaPerContractMin) },
        { key: 'collections.sessionTargetMin', value: String(dto.sessionTargetMin) },
        { key: 'collections.selfClaimLockHours', value: String(dto.selfClaimLockHours) },
      ],
      user.id,
    );
    return this.settingsService.getCollectionsConfig();
  }

  // ─── D1.1.5.5 — Petty Cash custodian ─────────────────────────────────

  /**
   * Read the currently-assigned Petty Cash custodian (and configured role
   * whitelist) for the given CompanyInfo (FINANCE by default).
   */
  @Get('petty-cash/custodian')
  getPettyCashCustodian(@Query('companyId') companyId?: string) {
    return this.settingsService.getPettyCashCustodian(companyId);
  }

  /**
   * Read the eligible-user pool for the Petty Cash custodian picker —
   * active users matching the configured role.
   */
  @Get('petty-cash/eligible-custodians')
  getEligibleCustodians() {
    return this.settingsService.getEligibleCustodians();
  }

  /**
   * Assign (or clear) the Petty Cash custodian on a CompanyInfo. OWNER-only
   * via the class-level @Roles('OWNER'). Validates target user.role against
   * the configured whitelist (`petty_cash_custodian_role`).
   */
  @Put('petty-cash/custodian')
  assignPettyCashCustodian(
    @Body() dto: AssignPettyCashCustodianDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.settingsService.assignPettyCashCustodian(user.id, {
      companyId: dto.companyId,
      userId: dto.userId,
    });
  }
}
