import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { SKIP_CSRF_KEY } from './skip-csrf.decorator';

/**
 * CSRF defense-in-depth: requires X-Requested-With header on state-changing requests.
 * This header cannot be set cross-origin without CORS preflight approval.
 * Combined with sameSite: strict cookies and CORS origin checking, this provides
 * robust CSRF protection.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
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

    // Require X-Requested-With header (set by axios/fetch)
    const xRequestedWith = request.headers['x-requested-with'];
    if (!xRequestedWith) {
      throw new ForbiddenException('Missing X-Requested-With header');
    }

    return true;
  }
}
