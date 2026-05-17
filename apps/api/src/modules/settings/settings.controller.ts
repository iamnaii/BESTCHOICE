import { Controller, Get, Patch, Put, Body, Query, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { BulkUpdateSettingsDto } from './dto/update-settings.dto';
import { CollectionsConfigDto } from './dto/collections-config.dto';
import { AssignPettyCashCustodianDto } from './dto/petty-cash-custodian.dto';
import { UpdateRoleMapDto } from './dto/update-role-map.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  AccountRoleService,
  ROLE_MAP_READ_ROLES,
  ROLE_MAP_WRITE_ROLES,
} from '../journal/account-role.service';
import { RoleMapValidationService } from './role-map-validation.service';
import { SettingsAccessGuard, AllowAnyAuthenticated } from './settings-access.guard';

/**
 * D1.3.2.2 — class-level `@Roles(...)` is widened to the SUPERSET of any
 * value the dynamic SystemConfig key `settings_access_role` may select
 * (OWNER+FINANCE_MANAGER+BRANCH_MANAGER+ACCOUNTANT). `SettingsAccessGuard`
 * then narrows per-request based on the live SystemConfig value. Default
 * `settings_access_role = 'OWNER'` preserves OWNER-only behavior, so
 * flipping the SystemConfig row is opt-in.
 *
 * SALES is intentionally excluded from the superset — settings are not
 * sales-team workflows; widening to SALES would require a fresh security
 * review.
 *
 * Per-route `@Roles(...)` decorators (e.g. role-map endpoints) still
 * narrow the class-level allowed set as before.
 */
@ApiTags('Settings')
@ApiBearerAuth('JWT')
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard, SettingsAccessGuard)
@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT')
export class SettingsController {
  constructor(
    private settingsService: SettingsService,
    private accountRoleService: AccountRoleService,
    private roleMapValidation: RoleMapValidationService,
  ) {}

  @Get()
  findAll() {
    return this.settingsService.findAll();
  }

  /**
   * D1.* — UI feature flags read by web app for non-OWNER users (payroll
   * editors, accountants etc.). Authenticated but NOT @Roles-gated so the
   * web app can fetch them in any role context.
   *
   * D1.3.2.2 — bypass SettingsAccessGuard so SALES (and any other
   * authenticated role) can still fetch their ui-flags regardless of the
   * `settings_access_role` SystemConfig value.
   */
  @Get('ui-flags')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  @AllowAnyAuthenticated()
  getUiFlags() {
    return this.settingsService.getUiFlags();
  }

  /**
   * D1.1.1.2 / D1.1.1.7 — Read account_role_map joined with CoA.
   *
   * Permission: OWNER + FINANCE_MANAGER + ACCOUNTANT (read-only).
   * Explicit `...ROLE_MAP_READ_ROLES` spread keeps the decorator + the
   * `assertCanRead()` runtime check pointing at the same constant — no
   * drift possible.
   */
  @Get('role-map')
  @Roles(...ROLE_MAP_READ_ROLES)
  getRoleMap(@CurrentUser() user: { id: string; role: string }) {
    // D1.1.1.7 — runtime double-check (defense in depth — if a future
    // refactor widens the decorator scope, this still blocks).
    this.accountRoleService.assertCanRead(user.role);
    return this.accountRoleService.listWithCoa();
  }

  /**
   * D1.1.1.3 + D1.1.1.5 + D1.1.1.7 — Update one role-map row (OWNER-only).
   *
   * - Permission (D1.1.1.7): `@Roles(...ROLE_MAP_WRITE_ROLES)` + the
   *   service-side `assertCanWrite()` gate — defense in depth.
   * - Validation (D1.1.1.5): `RoleMapValidationService.validateUpdate`
   *   handles the required-role lock, CoA presence + normal-balance match,
   *   priority uniqueness per role. Service `update()` invokes it via the
   *   `validate` callback so other entry points (POST, bulk) can reuse.
   */
  @Put('role-map/:id')
  @Roles(...ROLE_MAP_WRITE_ROLES)
  updateRoleMap(
    @Param('id') id: string,
    @Body() dto: UpdateRoleMapDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.accountRoleService.update(
      id,
      dto,
      user.id,
      user.role,
      (args) => this.roleMapValidation.validateUpdate(args),
    );
  }

  @Patch()
  bulkUpdate(
    @Body() dto: BulkUpdateSettingsDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    // D1.3.2.2 (S3) — pass role for service-side defense-in-depth check.
    return this.settingsService.bulkUpdate(dto.items, user.id, user.role);
  }

  @Get('collections')
  getCollectionsConfig() {
    return this.settingsService.getCollectionsConfig();
  }

  @Put('collections')
  async updateCollectionsConfig(
    @Body() dto: CollectionsConfigDto,
    @CurrentUser() user: { id: string; role: string },
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
      user.role,
    );
    return this.settingsService.getCollectionsConfig();
  }

  // ─── D1.1.5.5 — Petty Cash custodian ─────────────────────────────────

  /**
   * Read the currently-assigned Petty Cash custodian (and configured role
   * whitelist) for the given CompanyInfo (FINANCE by default).
   * OWNER-only — explicit method-level @Roles so we don't accidentally
   * inherit a broader class-level decorator if it's ever loosened.
   */
  @Get('petty-cash/custodian')
  @Roles('OWNER')
  getPettyCashCustodian(@Query('companyId') companyId?: string) {
    return this.settingsService.getPettyCashCustodian(companyId);
  }

  /**
   * Read the eligible-user pool for the Petty Cash custodian picker —
   * active users matching the configured role. OWNER-only — see note above.
   */
  @Get('petty-cash/eligible-custodians')
  @Roles('OWNER')
  getEligibleCustodians() {
    return this.settingsService.getEligibleCustodians();
  }

  /**
   * Assign (or clear) the Petty Cash custodian on a CompanyInfo. OWNER-only.
   * Validates target user.role against the configured whitelist
   * (`petty_cash_custodian_role`).
   */
  @Put('petty-cash/custodian')
  @Roles('OWNER')
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
