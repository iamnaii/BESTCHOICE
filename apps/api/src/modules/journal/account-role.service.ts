import {
  Injectable,
  OnModuleInit,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

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
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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

  /** D1.1.1.5 — public access to the required-roles whitelist. */
  static getRequiredRoles(): readonly string[] {
    return AccountRoleService.REQUIRED_ROLES;
  }

  /**
   * D1.1.1.2 — Joined list for admin UI table view.
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

  /**
   * D1.1.1.6 — Create a new role mapping with `ROLE_MAP_CREATED` audit.
   * For future POST endpoint or bulk-import flows; not exposed via PUT.
   */
  async create(
    dto: {
      role: string;
      accountCode: string;
      priority?: number;
      note?: string | null;
    },
    userId: string,
  ): Promise<{
    id: string;
    role: string;
    accountCode: string;
    priority: number;
    isActive: boolean;
    note: string | null;
  }> {
    // CoA presence check — the row must point to a real account.
    const coa = await this.prisma.chartOfAccount.findFirst({
      where: { code: dto.accountCode, deletedAt: null },
      select: { code: true },
    });
    if (!coa) {
      throw new BadRequestException(`บัญชี ${dto.accountCode} ไม่พบในผังบัญชี`);
    }
    let created;
    try {
      created = await this.prisma.accountRoleMap.create({
        data: {
          role: dto.role,
          accountCode: dto.accountCode,
          priority: dto.priority ?? 1,
          isActive: true,
          note: dto.note ?? null,
        },
        select: {
          id: true,
          role: true,
          accountCode: true,
          priority: true,
          isActive: true,
          note: true,
        },
      });
    } catch (err) {
      // Unique constraint on (role, accountCode) — caller is trying to
      // re-insert an existing mapping.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Role "${dto.role}" + code "${dto.accountCode}" มีอยู่แล้วในระบบ`,
        );
      }
      throw err;
    }
    await this.audit.log({
      userId,
      action: 'ROLE_MAP_CREATED',
      entity: 'account_role_map',
      entityId: created.id,
      newValue: {
        role: created.role,
        accountCode: created.accountCode,
        priority: created.priority,
        isActive: created.isActive,
        note: created.note,
        diffSummary: `สร้าง role ${created.role} → ${created.accountCode}`,
      },
    });
    await this.invalidate();
    return created;
  }

  /**
   * D1.1.1.3 + D1.1.1.6 — Update + audit. Splits the audit action into:
   *  - `ROLE_MAP_DEACTIVATED` when `isActive` flips from true → false
   *    (separate action because it has compliance implications — a
   *    deactivated role causes JE template calls to throw).
   *  - `ROLE_MAP_UPDATED` for all other field changes.
   *
   * Either way, `diffSummary` provides a one-line human-readable change
   * description so OWNERs can grep the audit log without re-deriving.
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
  ): Promise<{
    id: string;
    role: string;
    accountCode: string;
    priority: number;
    isActive: boolean;
    note: string | null;
  }> {
    const before = await this.prisma.accountRoleMap.findUnique({ where: { id } });
    if (!before) {
      throw new NotFoundException(`ไม่พบแถวบัญชี role-map: ${id}`);
    }
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

    // D1.1.1.6 — pick action by whether this is a deactivation.
    const isDeactivation = before.isActive === true && updated.isActive === false;
    const action = isDeactivation ? 'ROLE_MAP_DEACTIVATED' : 'ROLE_MAP_UPDATED';

    await this.audit.log({
      userId,
      action,
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
        diffSummary: isDeactivation
          ? `ปิดใช้งาน role ${updated.role}`
          : `role ${updated.role}: ${diff.join(', ') || 'no field changes'}`,
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
