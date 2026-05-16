import { Injectable, OnModuleInit, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
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
    // D1.1.6.1 — rounding-tolerance adjustment roles. Required so a missing/
    // deactivated row fails at boot instead of throwing per-payment.
    'adj_underpay',
    'adj_overpay',
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
      // Trim sample to keep Sentry payload bounded as the role map grows.
      const knownRolesSample = [...this.cache.keys()].sort().slice(0, 20);
      Sentry.captureException(new Error(`AccountRoleService cache miss: ${role}`), {
        extra: { role, knownRolesSample, cacheSize: this.cache.size },
        tags: { component: 'AccountRoleService' },
      });
      this.logger.warn(
        `[Phase1] AccountRoleService: MISS role=${role} (known sample: ${knownRolesSample.join(',')})`,
      );
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
      // Deterministic ordering: role → priority → accountCode (final tiebreaker
      // so two same-priority rows for the same role resolve identically across
      // Postgres versions / restarts).
      orderBy: [{ role: 'asc' }, { priority: 'asc' }, { accountCode: 'asc' }],
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
      // Deterministic ordering: role → priority → accountCode (final tiebreaker
      // so two same-priority rows for the same role resolve identically across
      // Postgres versions / restarts).
      orderBy: [{ role: 'asc' }, { priority: 'asc' }, { accountCode: 'asc' }],
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
