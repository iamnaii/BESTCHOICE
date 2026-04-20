import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const REQUIRED_AUDIENCE_KEY = 'requiredAudience';

/**
 * Decorator to explicitly declare which JWT audience (`aud` claim) is required.
 *
 * Usage:
 *   @RequireAudience('admin')  — only admin JWTs (aud='admin') may enter
 *   @RequireAudience('shop')   — only shop/customer JWTs (aud='shop') may enter
 *
 * When applied, this overrides the path-based auto-detection logic.
 * If not applied, JwtAudienceGuard infers the required audience from the request path.
 */
export const RequireAudience = (aud: string) => SetMetadata(REQUIRED_AUDIENCE_KEY, aud);

// ---------- Path-based audience rules ----------

/** Shop customer app paths — require aud='shop' */
const SHOP_PATH = /^\/api\/shop\//;

/**
 * Public paths — no JWT audience requirement.
 * Note: middleware strips /api/admin/* → /api/* before guards run,
 * so these patterns match the post-strip path.
 */
const PUBLIC_PATHS = [
  /^\/api\/chatbot-finance-liff\//,
  /^\/api\/sms-webhook/,
  /^\/api\/paysolutions/,
  /^\/api\/address(\/|$)/,
  /^\/api\/health/,
  /^\/api\/auth\//,
];

/**
 * 2FA / temp-token paths — accept aud='admin' OR aud='2fa_setup' OR aud='2fa_login'.
 * These endpoints are called with short-lived temp tokens issued during 2FA setup.
 */
const TEMP_TOKEN_PATHS = [/^\/api\/2fa\//];

// ---------- Guard ----------

/**
 * JwtAudienceGuard — enforces the `aud` claim on a JWT.
 *
 * Two modes:
 *   1. **Decorator mode**: if `@RequireAudience('X')` is present, aud must match exactly.
 *   2. **Path-based mode** (default): audience requirement is inferred from the request path.
 *
 * Path rules (applied after AdminPrefixMiddleware strips /api/admin/* → /api/*):
 *   /api/shop/*                    → require aud='shop'
 *   /api/chatbot-finance-liff/*    → public (no requirement)
 *   /api/sms-webhook, /api/paysolutions, /api/address/*, /api/health → public
 *   /api/auth/*                    → public (login endpoints — no JWT yet)
 *   /api/2fa/*                     → admin OR 2FA temp tokens
 *   All other /api/*               → require aud='admin'
 *
 * Register as APP_GUARD in app.module.ts — runs after JwtAuthGuard sets req.user.
 */
@Injectable()
export class JwtAudienceGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const path: string = req.path as string;

    // ---- Mode 1: decorator override ----
    const decoratorAud = this.reflector.getAllAndOverride<string>(REQUIRED_AUDIENCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (decoratorAud !== undefined) {
      // Explicit decorator — enforce strictly
      if (!req.user) return true; // no user → let JwtAuthGuard handle it
      const aud = req.user.aud as string | undefined;
      if (aud !== decoratorAud) {
        throw new ForbiddenException(
          `This endpoint requires audience: ${decoratorAud}, got: ${aud ?? 'none'}`,
        );
      }
      return true;
    }

    // ---- Mode 2: path-based auto-detection ----

    // Public / non-JWT paths — no audience enforcement
    if (PUBLIC_PATHS.some((re) => re.test(path))) return true;

    // No JWT user — let JwtAuthGuard handle the auth failure
    if (!req.user) return true;

    const aud = req.user.aud as string | undefined;

    // /api/shop/* — require aud='shop'
    if (SHOP_PATH.test(path)) {
      if (aud !== 'shop') {
        throw new ForbiddenException('This endpoint requires shop audience');
      }
      return true;
    }

    // /api/2fa/* — accept admin OR 2FA temp tokens
    if (TEMP_TOKEN_PATHS.some((re) => re.test(path))) {
      if (aud !== 'admin' && aud !== '2fa_login' && aud !== '2fa_setup') {
        throw new ForbiddenException('This endpoint requires admin or 2FA audience');
      }
      return true;
    }

    // All other /api/* — require aud='admin'
    if (path.startsWith('/api/')) {
      if (aud !== 'admin') {
        throw new ForbiddenException('Admin endpoint requires admin audience');
      }
      return true;
    }

    return true;
  }
}
