import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * InternalControlActionBar — shared dynamic role gate for the reverse / void
 * endpoint across all three accounting modules (Other Income, Expense, Asset).
 *
 * Resolves the allowed reverse-permission set from SystemConfig key
 * `reverse_permission`. Supports four whitelisted modes:
 *
 *   - `'OWNER_ONLY'`                       — tightest (OWNER only)
 *   - `'OWNER+FINANCE_MANAGER'`            — default (legacy D1.3.2.4 behavior)
 *   - `'OWNER+FINANCE_MANAGER+ACCOUNTANT'` — widest role bundle
 *   - `'CUSTOM'`                           — per-user opt-in via
 *     `User.canReverseOverride = true`. OWNER is always allowed regardless.
 *
 * Unknown values fall back to the default. DB errors fall back to default.
 *
 * Historically lived in `expense-documents/reverse-permission.guard.ts`;
 * that file now re-exports from here for backward compatibility.
 */
const DEFAULT_VALUE = 'OWNER+FINANCE_MANAGER' as const;

export type ReversePermissionMode =
  | 'OWNER_ONLY'
  | 'OWNER+FINANCE_MANAGER'
  | 'OWNER+FINANCE_MANAGER+ACCOUNTANT'
  | 'CUSTOM';

/**
 * Role bundles for the three static modes. The CUSTOM mode does NOT have a
 * fixed role set — it falls back to checking `User.canReverseOverride` per
 * request, with OWNER always allowed.
 */
export const REVERSE_PERMISSION_ROLE_SETS: Record<
  Exclude<ReversePermissionMode, 'CUSTOM'>,
  ReadonlySet<string>
> = {
  OWNER_ONLY: new Set(['OWNER']),
  'OWNER+FINANCE_MANAGER': new Set(['OWNER', 'FINANCE_MANAGER']),
  'OWNER+FINANCE_MANAGER+ACCOUNTANT': new Set(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']),
};

const ALL_MODES: ReversePermissionMode[] = [
  'OWNER_ONLY',
  'OWNER+FINANCE_MANAGER',
  'OWNER+FINANCE_MANAGER+ACCOUNTANT',
  'CUSTOM',
];

/**
 * Reads SystemConfig.reverse_permission and returns the active mode.
 * Defaults to OWNER+FM on missing key, unknown value, or DB error.
 */
export async function resolveReversePermissionMode(
  prisma: PrismaService,
): Promise<ReversePermissionMode> {
  try {
    const row = await prisma.systemConfig.findFirst({
      where: { key: 'reverse_permission', deletedAt: null },
      select: { value: true },
    });
    const raw = row?.value?.trim() as ReversePermissionMode | undefined;
    if (raw && ALL_MODES.includes(raw)) return raw;
    return DEFAULT_VALUE;
  } catch {
    return DEFAULT_VALUE;
  }
}

/**
 * Backward-compatible resolver — returns the role set for the active mode.
 * For CUSTOM mode, returns just OWNER (per-user check happens in the guard
 * via `canReverseOverride`); callers using this for static role-set checks
 * should additionally call `canUserReverseCustom()` if mode === 'CUSTOM'.
 *
 * Still used by `expense-documents.service.ts` for S3 defense-in-depth.
 */
export async function resolveReversePermissionRoles(
  prisma: PrismaService,
): Promise<ReadonlySet<string>> {
  const mode = await resolveReversePermissionMode(prisma);
  if (mode === 'CUSTOM') return new Set(['OWNER']);
  return REVERSE_PERMISSION_ROLE_SETS[mode];
}

/**
 * Per-user reverse permission check. Combines:
 *  - the SystemConfig mode (3 static role bundles + CUSTOM)
 *  - the per-user `canReverseOverride` flag (only consulted when mode = CUSTOM)
 *
 * OWNER is ALWAYS allowed regardless of mode — they are the policy owner.
 */
export async function canUserReverse(
  prisma: PrismaService,
  userId: string,
  userRole: string,
): Promise<boolean> {
  if (userRole === 'OWNER') return true;

  const mode = await resolveReversePermissionMode(prisma);

  if (mode === 'CUSTOM') {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { canReverseOverride: true },
    });
    return user?.canReverseOverride === true;
  }

  return REVERSE_PERMISSION_ROLE_SETS[mode].has(userRole);
}

@Injectable()
export class ReversePermissionGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: { id?: string; role?: string };
    }>();
    const user = request.user;
    if (!user || !user.id || !user.role) {
      throw new ForbiddenException('ไม่พบข้อมูลผู้ใช้');
    }
    const ok = await canUserReverse(this.prisma, user.id, user.role);
    if (ok) return true;
    throw new ForbiddenException('ไม่มีสิทธิ์กลับรายการเอกสาร');
  }

  /**
   * Legacy helper — returns the static role set for the active mode.
   * For CUSTOM mode the result is `{OWNER}` only (per-user check happens
   * inside `canActivate` via `canUserReverse`).
   */
  async getAllowedRoles(): Promise<ReadonlySet<string>> {
    return resolveReversePermissionRoles(this.prisma);
  }
}
