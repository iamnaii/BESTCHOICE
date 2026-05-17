import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * D1.3.2.4 — Dynamic role gate for the `POST /expense-documents/:id/void`
 * endpoint (reverse / void). SystemConfig key `reverse_permission`
 * (whitelisted) controls which roles can reverse a posted doc.
 *
 * Allowed values:
 *   - `'OWNER+FINANCE_MANAGER'` (default — current behavior, matches the
 *     pre-existing static `@Roles('OWNER', 'FINANCE_MANAGER')` decorator)
 *   - `'OWNER_ONLY'` (tightens to OWNER only)
 *
 * Default preserves current behavior. On DB error or malformed value the
 * guard falls back to default. Q4-gated: owner can flip the SystemConfig
 * row when ready.
 *
 * Pattern: mirrors `PostPermissionGuard` (D1.3.2.3) and `readBoolFlag`
 * (PR #884).
 */
const DEFAULT_VALUE = 'OWNER+FINANCE_MANAGER' as const;

export const REVERSE_PERMISSION_ROLE_SETS: Record<string, ReadonlySet<string>> = {
  'OWNER+FINANCE_MANAGER': new Set(['OWNER', 'FINANCE_MANAGER']),
  OWNER_ONLY: new Set(['OWNER']),
};

/**
 * Shared resolver — reads SystemConfig.reverse_permission and returns the
 * matching role set. Defaults to OWNER+FM on missing key, unknown value,
 * or DB error.
 *
 * Used by both `ReversePermissionGuard.canActivate` (primary gate) AND
 * service-side `assertCanReverseByRole()` (S3 defense-in-depth).
 */
export async function resolveReversePermissionRoles(
  prisma: PrismaService,
): Promise<ReadonlySet<string>> {
  try {
    const row = await prisma.systemConfig.findFirst({
      where: { key: 'reverse_permission', deletedAt: null },
      select: { value: true },
    });
    const raw = row?.value?.trim();
    if (raw && REVERSE_PERMISSION_ROLE_SETS[raw]) return REVERSE_PERMISSION_ROLE_SETS[raw];
    return REVERSE_PERMISSION_ROLE_SETS[DEFAULT_VALUE];
  } catch {
    return REVERSE_PERMISSION_ROLE_SETS[DEFAULT_VALUE];
  }
}

@Injectable()
export class ReversePermissionGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: { role?: string } }>();
    const user = request.user;
    if (!user || !user.role) {
      throw new ForbiddenException('ไม่พบข้อมูลผู้ใช้');
    }
    const allowed = await this.getAllowedRoles();
    if (allowed.has(user.role)) return true;
    throw new ForbiddenException('ไม่มีสิทธิ์กลับรายการเอกสาร');
  }

  async getAllowedRoles(): Promise<ReadonlySet<string>> {
    return resolveReversePermissionRoles(this.prisma);
  }
}
