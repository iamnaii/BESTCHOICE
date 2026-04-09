import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/nestjs';

/**
 * RequestIdMiddleware — request-level tracing via x-request-id header.
 *
 * - Reads x-request-id from the incoming request (forwarded by load-balancer / client).
 * - Falls back to a freshly generated UUID v4 when the header is absent.
 * - Echoes the final ID back to the caller in the response header so logs can be correlated
 *   from browser → API → Sentry in one hop.
 * - Tags the current Sentry scope so every event captured during this request carries
 *   the same request_id — no manual tagging needed in services or controllers.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const requestId =
      (req.headers['x-request-id'] as string | undefined)?.trim() || randomUUID();

    // Make available downstream (e.g. in custom interceptors / logger)
    req.headers['x-request-id'] = requestId;
    res.setHeader('x-request-id', requestId);

    // Tag Sentry scope so all errors within this request share the same request_id
    Sentry.withScope((scope) => {
      scope.setTag('request_id', requestId);
      next();
    });
  }
}
