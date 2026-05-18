import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Marker metadata key — controller routes that want to opt-OUT of the
 * dynamic settings-access check (e.g. `/settings/ui-flags`, which every
 * authenticated user needs to read) can set this via the
 * `@AllowAnyAuthenticated()` decorator below.
 */
export const SETTINGS_ACCESS_BYPASS = 'settings_access_bypass';

/**
 * D1.3.2.2 — Dynamic role gate for the Settings controller.
 *
 * SystemConfig key `settings_access_role` (whitelisted, default `'OWNER'`)
 * controls which roles can hit the Settings CRUD endpoints. Default
 * matches the pre-existing static `@Roles('OWNER')` behavior, so flipping
 * the SystemConfig row is opt-in and current owners see no change.
 *
 * Allowed values:
 *   - `'OWNER'` (default — current behavior)
 *   - `'OWNER+FINANCE_MANAGER'`
 *   - `'OWNER+ACCOUNTANT'`
 *   - `'OWNER+ALL'` (OWNER + FINANCE_MANAGER + BRANCH_MANAGER + ACCOUNTANT;
 *     intentionally excludes SALES — settings are non-trivial)
 *
 * The guard reads SystemConfig at request time via PrismaService directly
 * (mirrors the `readBoolFlag` pattern from PR #884 — keeps guard ctor
 * lean + sidesteps potential circular-dep risk). On DB error the guard
 * falls back to default OWNER-only.
 *
 * Routes that should remain accessible to ALL authenticated users (e.g.
 * `/settings/ui-flags`) must annotate themselves with the marker via
 * `@SetMetadata(SETTINGS_ACCESS_BYPASS, true)` (helper decorator below).
 * The class-level `@Roles(...)` on the controller is still enforced by
 * RolesGuard, so this guard only widens; it does not replace RolesGuard.
 *
 * Must be applied AFTER `JwtAuthGuard` and AFTER `RolesGuard` so the
 * widening decision sees `request.user`.
 *
 * Q4-gated: default behavior preserved. Owner can flip the SystemConfig
 * row when ready.
 */
export const SETTINGS_ACCESS_ALLOWED_VALUES = new Set<string>([
  'OWNER',
  'OWNER+FINANCE_MANAGER',
  'OWNER+ACCOUNTANT',
  'OWNER+ALL',
]);

export const SETTINGS_ACCESS_ROLE_SETS: Record<string, ReadonlySet<string>> = {
  OWNER: new Set(['OWNER']),
  'OWNER+FINANCE_MANAGER': new Set(['OWNER', 'FINANCE_MANAGER']),
  'OWNER+ACCOUNTANT': new Set(['OWNER', 'ACCOUNTANT']),
  'OWNER+ALL': new Set(['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT']),
};

/**
 * Shared resolver — reads SystemConfig.settings_access_role and returns
 * the corresponding role set. Defaults to OWNER-only on missing key,
 * unknown value, or DB error. Used by both `SettingsAccessGuard.canActivate`
 * AND service-side `assertCanWriteSettings()` defense-in-depth.
 */
export async function resolveSettingsAccessRoles(
  prisma: PrismaService,
): Promise<ReadonlySet<string>> {
  try {
    const row = await prisma.systemConfig.findFirst({
      where: { key: 'settings_access_role', deletedAt: null },
      select: { value: true },
    });
    const raw = row?.value?.trim();
    if (raw && SETTINGS_ACCESS_ALLOWED_VALUES.has(raw)) {
      return SETTINGS_ACCESS_ROLE_SETS[raw];
    }
    return SETTINGS_ACCESS_ROLE_SETS.OWNER;
  } catch {
    return SETTINGS_ACCESS_ROLE_SETS.OWNER;
  }
}

@Injectable()
export class SettingsAccessGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Opt-out via marker: e.g. /settings/ui-flags is for all authenticated users.
    const bypass = this.reflector.getAllAndOverride<boolean>(SETTINGS_ACCESS_BYPASS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (bypass === true) return true;

    const request = context.switchToHttp().getRequest<{ user?: { role?: string } }>();
    const user = request.user;
    if (!user || !user.role) {
      throw new ForbiddenException('ไม่พบข้อมูลผู้ใช้');
    }

    const allowed = await this.getAllowedRoles();
    if (allowed.has(user.role)) return true;

    throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงหน้าตั้งค่า');
  }

  /**
   * Resolve the SystemConfig key to a Set of allowed role names. Defaults
   * to OWNER-only if the key is missing, malformed, or DB read fails.
   */
  async getAllowedRoles(): Promise<ReadonlySet<string>> {
    return resolveSettingsAccessRoles(this.prisma);
  }
}

/**
 * Helper decorator for routes that intentionally allow any authenticated
 * user, bypassing the SettingsAccessGuard widening logic. Use sparingly —
 * only routes that genuinely need cross-role access (e.g. ui-flags) should
 * carry this marker.
 */
export const AllowAnyAuthenticated = () => SetMetadata(SETTINGS_ACCESS_BYPASS, true);
