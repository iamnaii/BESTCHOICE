import {
  Injectable,
  OnModuleInit,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * D1.1.1.7 — Role permission constants. Single source of truth for which
 * roles can read vs write the account_role_map. Used by both the @Roles
 * decorators on the controller AND the runtime `assertCanWrite()` guard
 * (defense in depth — if a future refactor accidentally widens the
 * decorator scope, the service-level check still blocks the write).
 */
export const ROLE_MAP_READ_ROLES = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'] as const;
export const ROLE_MAP_WRITE_ROLES = ['OWNER'] as const;
export type RoleMapReadRole = (typeof ROLE_MAP_READ_ROLES)[number];
export type RoleMapWriteRole = (typeof ROLE_MAP_WRITE_ROLES)[number];

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
    // D1.1.6.2 — rounding-tolerance routing role (≤1฿ overpay adjustment on
    // Payment). Seeded by migration 20260919000000_add_account_role_map.
    // Owner may remap via admin UI without redeploying the JE templates.
    'adj_overpay',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * D1.1.1.7 — Runtime double-check that the caller can write to
   * account_role_map. Throws ForbiddenException with a Thai message
   * otherwise. The @Roles decorator on the controller is the primary
   * gate; this is a defense-in-depth check that survives accidental
   * decorator removal in future refactors.
   */
  assertCanWrite(userRole: string | undefined): void {
    const allowed = ROLE_MAP_WRITE_ROLES as readonly string[];
    if (!userRole || !allowed.includes(userRole)) {
      throw new ForbiddenException(
        `เฉพาะ OWNER เท่านั้นที่แก้ไข role mapping ได้ (role ปัจจุบัน: ${userRole ?? 'unknown'})`,
      );
    }
  }

  /**
   * D1.1.1.7 — Read-side guard. Throws ForbiddenException unless the
   * caller has one of `ROLE_MAP_READ_ROLES`.
   */
  assertCanRead(userRole: string | undefined): void {
    const allowed = ROLE_MAP_READ_ROLES as readonly string[];
    if (!userRole || !allowed.includes(userRole)) {
      throw new ForbiddenException(
        `ไม่มีสิทธิ์อ่าน role mapping (role ปัจจุบัน: ${userRole ?? 'unknown'})`,
      );
    }
  }

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

  /**
   * D1.1.1.2 — All AccountRoleMap rows (incl. inactive) joined with
   * ChartOfAccount.name. Returned to the admin UI so editors can see both
   * the canonical role mapping and the human-readable account name without
   * a second round-trip per row. The "required" flag tells the UI which
   * roles cannot be deactivated (REQUIRED_ROLES list — protects boot
   * invariants in `assertRequiredRolesPresent`).
   */
  async listWithCoa(): Promise<
    Array<{
      id: string;
      role: string;
      accountCode: string;
      accountName: string | null;
      priority: number;
      isActive: boolean;
      note: string | null;
      required: boolean;
    }>
  > {
    const rows = await this.prisma.accountRoleMap.findMany({
      orderBy: [{ role: 'asc' }, { priority: 'asc' }],
      select: {
        id: true,
        role: true,
        accountCode: true,
        priority: true,
        isActive: true,
        note: true,
      },
    });
    if (rows.length === 0) return [];
    const codes = Array.from(new Set(rows.map((r) => r.accountCode)));
    const coas = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: codes }, deletedAt: null },
      select: { code: true, name: true },
    });
    const nameByCode = new Map(coas.map((c) => [c.code, c.name]));
    const requiredSet = new Set<string>(AccountRoleService.REQUIRED_ROLES);
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      accountCode: r.accountCode,
      accountName: nameByCode.get(r.accountCode) ?? null,
      priority: r.priority,
      isActive: r.isActive,
      note: r.note,
      required: requiredSet.has(r.role),
    }));
  }

  /** D1.1.1.5 — public access to the required-roles whitelist. */
  static getRequiredRoles(): readonly string[] {
    return AccountRoleService.REQUIRED_ROLES;
  }

  /**
   * D1.1.1.3 + D1.1.1.5 + D1.1.1.7 — Update a single AccountRoleMap row.
   *
   * Permission (D1.1.1.7): the caller MUST pass `userRole`. `assertCanWrite`
   * runs FIRST — before any DB I/O — as defense-in-depth so that even if a
   * future refactor accidentally widens the controller's @Roles decorator,
   * the service-level OWNER check still rejects the write.
   *
   * Validation (D1.1.1.5): delegated to `RoleMapValidationService.validateUpdate`
   * via the optional `validate` callback (callable by PUT, future POST,
   * bulk-import). When the callback is not supplied (unit tests without
   * the settings module), an inline mirror of the canonical rules runs.
   *
   * Audit: writes `ROLE_MAP_UPDATED` with `diffSummary` then invalidates
   * the in-memory cache.
   */
  async update(
    id: string,
    dto: {
      accountCode?: string;
      priority?: number;
      isActive?: boolean;
      note?: string | null;
    },
    userId: string,
    userRole: string,
    validate?: (args: {
      id: string;
      currentRow: {
        id: string;
        role: string;
        accountCode: string;
        priority: number;
        isActive: boolean;
      };
      update: { accountCode?: string; priority?: number; isActive?: boolean };
    }) => Promise<void>,
  ): Promise<{
    id: string;
    role: string;
    accountCode: string;
    priority: number;
    isActive: boolean;
    note: string | null;
  }> {
    // D1.1.1.7 — runtime double-check that the caller is OWNER.
    // MUST run before any DB I/O so an unauthorised caller never even
    // sees the existence of the row.
    this.assertCanWrite(userRole);

    const before = await this.prisma.accountRoleMap.findUnique({ where: { id } });
    if (!before) {
      throw new NotFoundException(`ไม่พบแถวบัญชี role-map: ${id}`);
    }
    if (validate) {
      await validate({
        id,
        currentRow: {
          id: before.id,
          role: before.role,
          accountCode: before.accountCode,
          priority: before.priority,
          isActive: before.isActive,
        },
        update: {
          accountCode: dto.accountCode,
          priority: dto.priority,
          isActive: dto.isActive,
        },
      });
    } else {
      // Fallback inline checks if no validator supplied (keeps the
      // service self-sufficient for unit tests that don't import the
      // settings module). Mirrors the canonical rules.
      if (
        dto.isActive === false &&
        AccountRoleService.REQUIRED_ROLES.includes(before.role)
      ) {
        throw new BadRequestException(
          `Role "${before.role}" จำเป็นสำหรับการทำงานของระบบ — ห้ามปิดใช้งาน`,
        );
      }
      if (dto.accountCode && dto.accountCode !== before.accountCode) {
        const coa = await this.prisma.chartOfAccount.findFirst({
          where: { code: dto.accountCode, deletedAt: null },
          select: { code: true },
        });
        if (!coa) {
          throw new BadRequestException(`บัญชี ${dto.accountCode} ไม่พบในผังบัญชี`);
        }
      }
    }
    const updateData: Prisma.AccountRoleMapUpdateInput = {};
    if (dto.accountCode !== undefined) updateData.accountCode = dto.accountCode;
    if (dto.priority !== undefined) updateData.priority = dto.priority;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.note !== undefined) updateData.note = dto.note;
    const updated = await this.prisma.accountRoleMap.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        role: true,
        accountCode: true,
        priority: true,
        isActive: true,
        note: true,
      },
    });
    const diff: string[] = [];
    if (dto.accountCode !== undefined && dto.accountCode !== before.accountCode) {
      diff.push(`accountCode: ${before.accountCode} → ${updated.accountCode}`);
    }
    if (dto.priority !== undefined && dto.priority !== before.priority) {
      diff.push(`priority: ${before.priority} → ${updated.priority}`);
    }
    if (dto.isActive !== undefined && dto.isActive !== before.isActive) {
      diff.push(`isActive: ${before.isActive} → ${updated.isActive}`);
    }
    if (dto.note !== undefined && dto.note !== before.note) {
      diff.push(`note: ${before.note ?? '—'} → ${updated.note ?? '—'}`);
    }
    await this.audit.log({
      userId,
      action: 'ROLE_MAP_UPDATED',
      entity: 'account_role_map',
      entityId: id,
      oldValue: {
        role: before.role,
        accountCode: before.accountCode,
        priority: before.priority,
        isActive: before.isActive,
        note: before.note,
      },
      newValue: {
        role: updated.role,
        accountCode: updated.accountCode,
        priority: updated.priority,
        isActive: updated.isActive,
        note: updated.note,
        diffSummary: `role ${updated.role}: ${diff.join(', ') || 'no field changes'}`,
      },
    });
    await this.invalidate();
    return updated;
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
