import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';

/**
 * CSRF defense-in-depth: requires X-Requested-With header on state-changing requests.
 * This header cannot be set cross-origin without CORS preflight approval.
 * Combined with sameSite: strict cookies and CORS origin checking, this provides
 * robust CSRF protection.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();

    // Only check state-changing methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    // Require X-Requested-With header (set by axios/fetch)
    const xRequestedWith = request.headers['x-requested-with'];
    if (!xRequestedWith) {
      throw new ForbiddenException('Missing X-Requested-With header');
    }

    return true;
  }
}
