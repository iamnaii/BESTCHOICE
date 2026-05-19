import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * SP7.8 — Attaches the resolved entity scope (SHOP | FINANCE) as a Sentry
 * tag on every request scope so error reports are automatically segmented by
 * entity. This makes it trivial to filter Sentry events to "only FINANCE
 * errors" or "only SHOP errors" after the SP7.1 dual-entity split.
 *
 * Must run after EntityScopeMiddleware (which writes req.entityScope).
 *
 * Lazy-require pattern: @sentry/nestjs is an optional dependency from the
 * runtime perspective — if SDK is not initialised (e.g. SENTRY_DSN unset in
 * dev), the call is a no-op and the request proceeds normally.
 */
@Injectable()
export class SentryEntityTagMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sentry = require('@sentry/nestjs') as typeof import('@sentry/nestjs');
      const scope = (req as Request & { entityScope?: string }).entityScope;
      if (scope) {
        // configureScope is available in Sentry SDK ≥6. Wrap in a type guard
        // to stay forward-compatible with future SDK versions.
        if (typeof (Sentry as Record<string, unknown>).configureScope === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (Sentry as any).configureScope((s: { setTag: (k: string, v: string) => void }) => {
            s.setTag('entity_scope', scope);
          });
        } else if (typeof (Sentry as Record<string, unknown>).withScope === 'function') {
          // Sentry SDK ≥8 deprecates configureScope in favour of withScope /
          // getCurrentScope. Keep working without crashing on upgrade.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (Sentry as any).getCurrentScope?.()?.setTag('entity_scope', scope);
        }
      }
    } catch {
      // Sentry not installed or not initialised — skip silently.
      // This middleware must never throw and must never block requests.
    }
    next();
  }
}
