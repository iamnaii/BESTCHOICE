import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

type Company = 'SHOP' | 'FINANCE';

/**
 * SP7.1 — Resolves the request's company scope and writes it to req.entityScope.
 *
 * Precedence:
 *   1. URL query: ?company=shop|finance (explicit override per request)
 *   2. Header:    x-company-scope: shop|finance (API client preference)
 *   3. User's primaryCompany (default for the role)
 *   4. Falls back to 'SHOP' if nothing set
 *
 * If the resolved scope is NOT in the user's accessibleCompanies list, the
 * request is rejected with 403 — even an OWNER cannot force-access an entity
 * they're not assigned to (defense-in-depth; UI already filters).
 *
 * Public endpoints (no req.user) are skipped — JwtAuthGuard determines auth.
 */
@Injectable()
export class EntityScopeMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    if (!req.user) return next();

    const user = req.user as Express.User & {
      accessibleCompanies?: string[];
      primaryCompany?: string | null;
    };

    const requested = this.resolveRequested(req);
    const target = (requested ?? user.primaryCompany ?? 'SHOP') as Company;

    if (!user.accessibleCompanies?.includes(target)) {
      return res.status(403).json({
        message: `ผู้ใช้ไม่มีสิทธิ์เข้าถึง company ${target}`,
        accessibleCompanies: user.accessibleCompanies ?? [],
      });
    }

    (req as Request & { entityScope?: Company }).entityScope = target;
    next();
  }

  private resolveRequested(req: Request): Company | null {
    const fromQuery = String(req.query.company ?? '').toUpperCase();
    if (fromQuery === 'SHOP' || fromQuery === 'FINANCE') return fromQuery;

    const fromHeader = String(req.headers['x-company-scope'] ?? '').toUpperCase();
    if (fromHeader === 'SHOP' || fromHeader === 'FINANCE') return fromHeader;

    return null;
  }
}
