import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { AuditService } from './audit.service';
import { sanitizeAuditValue } from './audit-sanitize.util';
import { clientIp } from '../../utils/client-ip.util';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { tap } = require('rxjs');

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, user } = request;

    // Only audit mutating operations
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next.handle();
    }

    const startTime = Date.now();
    const ipAddress = clientIp(request);
    const userAgent = request.headers['user-agent'] || '';

    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          // Skip audit for unauthenticated requests (login, register) to avoid FK violation
          if (!user?.id) return;

          const duration = Date.now() - startTime;
          // Try to extract entityId from response for POST (create) operations
          let entityId = this.extractEntityId(url);
          if (!entityId && method === 'POST' && responseBody && typeof responseBody === 'object') {
            entityId = responseBody.id;
          }

          void this.auditService.log({
            userId: user.id,
            action: method,
            entity: this.extractEntity(url),
            entityId,
            newValue: this.sanitizeBody(body),
            ipAddress,
            userAgent,
            duration,
          });
        },
        error: (err) => {
          // Skip audit for unauthenticated requests to avoid FK violation
          if (!user?.id) return;

          const duration = Date.now() - startTime;
          void this.auditService.log({
            userId: user.id,
            action: `${method}_ERROR`,
            entity: this.extractEntity(url),
            entityId: this.extractEntityId(url),
            newValue: {
              error: err.message,
              statusCode: err.status || err.statusCode || 500,
              body: this.sanitizeBody(body),
              duration,
            },
            ipAddress,
            userAgent,
            duration,
          });
        },
      }),
    );
  }

  private extractEntity(url: string): string {
    // Remove /api/ prefix and query string
    const path = url.replace(/^\/api\//, '').split('?')[0];
    const parts = path.split('/').filter(Boolean);

    // R-013: Extract the FIRST meaningful segment (primary entity) for nested URLs.
    // For /contracts/uuid/payments/uuid → "contracts" (the primary resource)
    // For /products/uuid → "products"
    // For /auth/login → "auth"
    // Previously walked backwards which returned "payments" for nested URLs,
    // losing the primary resource context in audit logs.
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Walk forward to find the first non-UUID segment (the primary entity)
    for (let i = 0; i < parts.length; i++) {
      if (!uuidRegex.test(parts[i])) {
        return parts[i];
      }
    }

    return parts[0] || 'unknown';
  }

  private extractEntityId(url: string): string | undefined {
    const path = url.split('?')[0];
    const parts = path.replace(/^\/api\//, '').split('/');
    // UUID pattern - find the last UUID in the URL
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const uuidParts = parts.filter((p) => uuidRegex.test(p));
    return uuidParts.length > 0 ? uuidParts[uuidParts.length - 1] : undefined;
  }

  private sanitizeBody(body: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) return undefined;
    return sanitizeAuditValue(body) as Record<string, unknown>;
  }
}
