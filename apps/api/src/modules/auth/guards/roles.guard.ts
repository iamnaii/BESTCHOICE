import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * VIEWER role gate (Owner Response Q4 signed 2026-05-17)
 *
 * The schema enum `UserRole.VIEWER` always exists so OWNER can create
 * read-only auditor accounts (CPA / สรรพากร). Whether requests from a
 * VIEWER user actually pass through depends on SystemConfig
 * `viewer_role_enabled`:
 *
 *   - flag = 'true'  → VIEWER passes routes that list 'VIEWER' in @Roles()
 *   - flag = 'false' → VIEWER is denied everywhere (treated as if no @Roles
 *                       decoration includes them)
 *
 * Cached in-process for 60 s so the hot path doesn't add a SystemConfig
 * query on every request. The flag changes rarely (owner toggle); the
 * staleness window is bounded.
 */
let viewerFlagCache: { value: boolean; expires: number } | null = null;
const VIEWER_FLAG_TTL_MS = 60_000;

/** Test-only: reset the cache between cases. */
export function __resetViewerFlagCacheForTests(): void {
  viewerFlagCache = null;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    if (!requiredRoles.includes(user.role)) {
      return false;
    }

    if (user.role === 'VIEWER') {
      return this.isViewerEnabled();
    }

    return true;
  }

  private async isViewerEnabled(): Promise<boolean> {
    const now = Date.now();
    if (viewerFlagCache && viewerFlagCache.expires > now) {
      return viewerFlagCache.value;
    }
    let value = false;
    try {
      const row = await this.prisma.systemConfig.findFirst({
        where: { key: 'viewer_role_enabled', deletedAt: null },
        select: { value: true },
      });
      value = row?.value === 'true';
    } catch {
      // DB read failure → fail closed (deny). Better to 403 an auditor
      // than to leak data if SystemConfig is unreachable.
      value = false;
    }
    viewerFlagCache = { value, expires: now + VIEWER_FLAG_TTL_MS };
    return value;
  }
}
