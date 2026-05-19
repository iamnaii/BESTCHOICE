import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * SP7.10 — Maintenance-mode toggle for cutover.
 *
 * Set MAINTENANCE_MODE=true env to block all writes (POST/PUT/PATCH/DELETE).
 * Reads (GET) continue so cached data + dashboards still usable during the
 * Dec 31 → Jan 1 cutover window.
 *
 * Whitelist /api/health, /api/version, and their sub-paths so liveness probes
 * and health dashboards remain accessible to operations staff.
 *
 * Activate:   MAINTENANCE_MODE=true  + Cloud Run redeploy
 * Deactivate: MAINTENANCE_MODE=false (or remove) + Cloud Run redeploy
 */

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const WHITELIST_PATHS = new Set(['/api/health', '/api/version']);

const WHITELIST_PREFIXES = ['/api/health/'];

@Injectable()
export class MaintenanceModeMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    if (process.env.MAINTENANCE_MODE !== 'true') return next();

    // Only block write methods
    if (!WRITE_METHODS.has(req.method)) return next();

    // Exact-path whitelist
    if (WHITELIST_PATHS.has(req.path)) return next();

    // Prefix whitelist (health sub-paths)
    if (WHITELIST_PREFIXES.some((p) => req.path.startsWith(p))) return next();

    res.status(503).json({
      message: 'ระบบอยู่ในช่วงบำรุงรักษา (P3-SP7 cutover) — กลับมาใช้งานปกติ 04:00 BKK',
      maintenance: true,
      retryAfter: '04:00 BKK',
    });
  }
}
