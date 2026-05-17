import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * D1.3.2.3 — Dynamic role gate for the `POST /expense-documents/:id/post`
 * endpoint. SystemConfig key `post_permission` (whitelisted) controls
 * which roles can transition a doc from DRAFT → ACCRUAL.
 *
 * Allowed values:
 *   - `'OWNER+FINANCE_MANAGER+ACCOUNTANT'` (default — current behavior,
 *     matches the pre-existing static @Roles decorator)
 *   - `'OWNER+FINANCE_MANAGER'`
 *   - `'OWNER_ONLY'`
 *   - `'OWNER+ALL_NON_SALES'` (OWNER+FINANCE_MANAGER+BRANCH_MANAGER+
 *     ACCOUNTANT — widens to BRANCH_MANAGER for branch-specific posting)
 *
 * Default preserves current behavior (OWNER+FM+ACC). On DB error or
 * malformed value the guard falls back to default. Q4-gated: owner can
 * flip the SystemConfig row when ready.
 *
 * Pattern: mirrors `SettingsAccessGuard` (D1.3.2.2) and `readBoolFlag`
 * (PR #884). The guard is route-specific — only the `post()` controller
 * method needs `@UseGuards(..., PostPermissionGuard)`.
 *
 * RolesGuard runs first with a WIDENED `@Roles(...)` on the method (the
 * superset of any value `post_permission` may select); this guard then
 * narrows per-request based on the live SystemConfig value.
 */
const DEFAULT_VALUE = 'OWNER+FINANCE_MANAGER+ACCOUNTANT' as const;

export const POST_PERMISSION_ROLE_SETS: Record<string, ReadonlySet<string>> = {
  'OWNER+FINANCE_MANAGER+ACCOUNTANT': new Set(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']),
  'OWNER+FINANCE_MANAGER': new Set(['OWNER', 'FINANCE_MANAGER']),
  OWNER_ONLY: new Set(['OWNER']),
  'OWNER+ALL_NON_SALES': new Set(['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT']),
};

/**
 * Shared resolver — reads SystemConfig.post_permission and returns the
 * matching role set. Defaults to the current OWNER+FM+ACC bundle on
 * missing key, unknown value, or DB error.
 *
 * Used by both `PostPermissionGuard.canActivate` (primary gate) AND
 * service-side `assertCanPost()` (S3 defense-in-depth).
 */
export async function resolvePostPermissionRoles(
  prisma: PrismaService,
): Promise<ReadonlySet<string>> {
  try {
    const row = await prisma.systemConfig.findFirst({
      where: { key: 'post_permission', deletedAt: null },
      select: { value: true },
    });
    const raw = row?.value?.trim();
    if (raw && POST_PERMISSION_ROLE_SETS[raw]) return POST_PERMISSION_ROLE_SETS[raw];
    return POST_PERMISSION_ROLE_SETS[DEFAULT_VALUE];
  } catch {
    return POST_PERMISSION_ROLE_SETS[DEFAULT_VALUE];
  }
}

@Injectable()
export class PostPermissionGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: { role?: string } }>();
    const user = request.user;
    if (!user || !user.role) {
      throw new ForbiddenException('ไม่พบข้อมูลผู้ใช้');
    }
    const allowed = await this.getAllowedRoles();
    if (allowed.has(user.role)) return true;
    throw new ForbiddenException('ไม่มีสิทธิ์โพสต์เอกสาร');
  }

  async getAllowedRoles(): Promise<ReadonlySet<string>> {
    return resolvePostPermissionRoles(this.prisma);
  }
}
