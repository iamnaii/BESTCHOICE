import { Injectable, OnModuleInit, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Resolves semantic roles → CoA codes via the `account_role_map` table
 * (Fix Report P1-3). Lets JE templates ask `role('vat_input')` instead of
 * hard-coding `'11-4101'`.
 *
 * Boot-time validation (`onModuleInit`) catches drift before the first doc
 * posts — every active role is checked against `chart_of_accounts` and a
 * configured min-set is required to exist.
 *
 * Cache is in-memory per app instance; admin UI must call `invalidate()`
 * after mutating the map (or restart pods).
 */
@Injectable()
export class AccountRoleService implements OnModuleInit {
  private readonly logger = new Logger(AccountRoleService.name);
  private cache = new Map<string, string>(); // role → accountCode

  /** Roles every deploy must have. Boot fails loudly if any are missing. */
  private static readonly REQUIRED_ROLES = [
    'vat_input',
    'vat_output',
    'payable_default',
    'wht_individual',
    'wht_juristic',
    'wht_payroll',
    'sso_employee',
    'sso_employer',
    'payroll_expense',
    'payroll_sso_expense',
    // D1.1.6.1 — rounding-tolerance routing role (≤1฿ underpay adjustment on
    // Payment). Seeded by migration 20260919000000_add_account_role_map.
    // Owner may remap via admin UI without redeploying the JE templates.
    'adj_underpay',
  ];

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.loadCache();
    this.assertRequiredRolesPresent();
    await this.assertCodesExistInCoa();
    this.logger.log(
      `[Phase1] AccountRoleService: loaded ${this.cache.size} active role(s)`,
    );
  }

  /**
   * Resolve role → account code. Throws if the role is missing or inactive.
   * Synchronous because the cache is fully primed by onModuleInit.
   */
  code(role: string): string {
    const accountCode = this.cache.get(role);
    if (!accountCode) {
      throw new BadRequestException(
        `AccountRoleService: role "${role}" not found in account_role_map ` +
          `(or not active). Check admin → account roles.`,
      );
    }
    return accountCode;
  }

  /** Soft variant: returns null instead of throwing — caller decides fallback. */
  tryCode(role: string): string | null {
    return this.cache.get(role) ?? null;
  }

  /** Convenience: all active roles for admin UI. */
  async list(): Promise<
    Array<{ role: string; accountCode: string; priority: number; note: string | null }>
  > {
    const rows = await this.prisma.accountRoleMap.findMany({
      where: { isActive: true },
      orderBy: [{ role: 'asc' }, { priority: 'asc' }],
      select: { role: true, accountCode: true, priority: true, note: true },
    });
    return rows;
  }

  /** Call after a mutation through the admin UI. */
  async invalidate(): Promise<void> {
    await this.loadCache();
    this.logger.log(`[Phase1] AccountRoleService: cache invalidated (${this.cache.size} active)`);
  }

  private async loadCache(): Promise<void> {
    const rows = await this.prisma.accountRoleMap.findMany({
      where: { isActive: true },
      orderBy: [{ role: 'asc' }, { priority: 'asc' }],
      select: { role: true, accountCode: true },
    });
    const next = new Map<string, string>();
    for (const r of rows) {
      // Lower priority number wins; later rows with same role + higher
      // priority are ignored. (Future: context-aware lookup uses priority.)
      if (!next.has(r.role)) next.set(r.role, r.accountCode);
    }
    this.cache = next;
  }

  private assertRequiredRolesPresent(): void {
    const missing = AccountRoleService.REQUIRED_ROLES.filter((r) => !this.cache.has(r));
    if (missing.length > 0) {
      throw new Error(
        `AccountRoleService: required role(s) missing from account_role_map: ${missing.join(', ')}. ` +
          'Run the seed (npm run seed:account-roles) or update the table.',
      );
    }
  }

  private async assertCodesExistInCoa(): Promise<void> {
    const codes = [...new Set(this.cache.values())];
    if (codes.length === 0) return;
    const found = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: codes }, deletedAt: null },
      select: { code: true },
    });
    const foundSet = new Set(found.map((c) => c.code));
    const missing = codes.filter((c) => !foundSet.has(c));
    if (missing.length > 0) {
      throw new Error(
        `AccountRoleService: account_role_map references ${missing.length} ` +
          `code(s) not present in chart_of_accounts: ${missing.join(', ')}. ` +
          'Either remove the rows or seed the missing accounts.',
      );
    }
  }

  /** For tests — re-seed cache from a fixture without hitting DB. */
  __setCacheForTests(map: Map<string, string>): void {
    this.cache = new Map(map);
  }
}

/** Re-exports the Prisma type so other files can import without depending on @prisma/client directly. */
export type AccountRoleRow = Prisma.AccountRoleMapGetPayload<Record<string, never>>;
