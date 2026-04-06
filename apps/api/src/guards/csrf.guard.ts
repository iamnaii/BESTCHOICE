import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { SKIP_CSRF_KEY } from './skip-csrf.decorator';

/**
 * CSRF defense-in-depth: requires X-Requested-With header on state-changing requests.
 * This header cannot be set cross-origin without CORS preflight approval.
 * Combined with sameSite: strict cookies and CORS origin checking, this provides
 * robust CSRF protection.
 *
 * Secondary defense: double-submit cookie validation.
 * If both X-CSRF-Token header and csrf_token cookie are present, they must match.
 * Currently in log-only mode for gradual rollout — mismatch logs a warning but does not block.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipCsrf) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();

    // Only check state-changing methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    // Primary defense: Require X-Requested-With header (set by axios/fetch)
    const xRequestedWith = request.headers['x-requested-with'];
    if (!xRequestedWith || xRequestedWith !== 'XMLHttpRequest') {
      throw new ForbiddenException('Missing or invalid X-Requested-With header');
    }

    // Secondary defense: Double-submit cookie check (log-only for gradual rollout)
    const csrfHeader = request.headers['x-csrf-token'] as string | undefined;
    const csrfCookie = request.cookies?.['csrf_token'] as string | undefined;

    if (csrfHeader && csrfCookie) {
      if (csrfHeader !== csrfCookie) {
        this.logger.warn(
          `CSRF token mismatch for ${request.method} ${request.url} — ` +
          `header and cookie values differ. Possible CSRF attack.`,
        );
      }
    } else if (!csrfHeader && !csrfCookie) {
      // Neither present — expected during gradual rollout, no action needed
    } else {
      this.logger.warn(
        `CSRF double-submit incomplete for ${request.method} ${request.url} — ` +
        `header: ${csrfHeader ? 'present' : 'missing'}, cookie: ${csrfCookie ? 'present' : 'missing'}`,
      );
    }

    return true;
  }
}
