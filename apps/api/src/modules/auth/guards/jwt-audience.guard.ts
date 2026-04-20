import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const REQUIRED_AUDIENCE_KEY = 'requiredAudience';

/**
 * Decorator to declare which JWT audience (`aud` claim) is required to access an endpoint.
 *
 * Usage:
 *   @RequireAudience('admin')  — only admin JWTs (aud='admin') may enter
 *   @RequireAudience('shop')   — only shop/customer JWTs (aud='shop') may enter
 *
 * Apply at class level to protect an entire controller, or at method level for
 * individual endpoints.  Works in conjunction with JwtAuthGuard (which verifies
 * the signature) — place JwtAudienceGuard AFTER JwtAuthGuard in @UseGuards so
 * req.user is already populated.
 */
export const RequireAudience = (aud: string) => SetMetadata(REQUIRED_AUDIENCE_KEY, aud);

/**
 * JwtAudienceGuard — enforces the `aud` claim on a JWT.
 *
 * - If no @RequireAudience decorator is present → guard passes (allow-by-default).
 * - If decorator is present → req.user.aud must match exactly.
 *
 * This prevents a shop customer JWT (aud='shop') from accessing admin-only
 * endpoints even if it passes signature validation, and vice-versa.
 */
@Injectable()
export class JwtAudienceGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string>(REQUIRED_AUDIENCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No audience requirement on this endpoint — allow unconditionally.
    if (!required) return true;

    const req = context.switchToHttp().getRequest();
    const aud = req.user?.aud;

    if (aud !== required) {
      throw new ForbiddenException(
        `This endpoint requires audience: ${required}, got: ${aud ?? 'none'}`,
      );
    }

    return true;
  }
}
