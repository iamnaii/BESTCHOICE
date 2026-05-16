import { Controller, Get, Patch, Put, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { BulkUpdateSettingsDto } from './dto/update-settings.dto';
import { CollectionsConfigDto } from './dto/collections-config.dto';
import { UpdateRoleMapDto } from './dto/update-role-map.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccountRoleService } from '../journal/account-role.service';

@ApiTags('Settings')
@ApiBearerAuth('JWT')
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class SettingsController {
  constructor(
    private settingsService: SettingsService,
    private accountRoleService: AccountRoleService,
  ) {}

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

  /**
   * D1.1.1.2 / .4 — Read role-map joined with chart_of_accounts.name. Read
   * is open to FINANCE_MANAGER + ACCOUNTANT (they verify routing before
   * posting); write (PUT below) stays OWNER-only.
   */
  @Get('role-map')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getRoleMap() {
    return this.accountRoleService.listWithCoa();
  }

  /**
   * D1.1.1.3 / .4 — Update one role-map row (OWNER-only). Validates
   * accountCode against chart_of_accounts and rejects deactivation of
   * REQUIRED_ROLES rows.
   */
  @Put('role-map/:id')
  @Roles('OWNER')
  updateRoleMap(
    @Param('id') id: string,
    @Body() dto: UpdateRoleMapDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.accountRoleService.update(id, dto, user.id);
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
}
