import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

/**
 * AdminPrefixMiddleware — strips `/admin` prefix from `/api/admin/*` requests.
 *
 * Allows the frontend admin app to use `/api/admin/X` URLs while all existing
 * controllers (mounted at `/api/X`) handle them transparently, with zero
 * controller refactoring needed.
 *
 * Security note: this rewrite is intentional — the admin audience boundary is
 * enforced at the JWT level via JwtAudienceGuard (@RequireAudience('admin')),
 * not by URL namespacing alone.
 *
 * Examples:
 *   /api/admin/customers       → /api/customers
 *   /api/admin/contracts/123   → /api/contracts/123
 *   /api/admin                 → /api
 *   /api/customers             → /api/customers  (unchanged)
 *   /api/shop/profile          → /api/shop/profile  (unchanged)
 */
@Injectable()
export class AdminPrefixMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    if (req.url.startsWith('/api/admin/')) {
      req.url = req.url.replace(/^\/api\/admin\//, '/api/');
    } else if (req.url === '/api/admin') {
      req.url = '/api';
    }
    next();
  }
}
