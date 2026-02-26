import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private static readonly SENSITIVE_FIELDS = [
    'password', 'token', 'secret', 'accessToken', 'refreshToken',
    'currentPassword', 'newPassword', 'confirmPassword',
  ];

  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, user } = request;

    // Only audit mutating operations
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next.handle();
    }

    const startTime = Date.now();
    const ipAddress = request.ip || request.headers['x-forwarded-for'] || '';
    const userAgent = request.headers['user-agent'] || '';

    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          const duration = Date.now() - startTime;
          // Try to extract entityId from response for POST (create) operations
          let entityId = this.extractEntityId(url);
          if (!entityId && method === 'POST' && responseBody && typeof responseBody === 'object') {
            entityId = responseBody.id;
          }

          this.auditService.log({
            userId: user?.id,
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
          const duration = Date.now() - startTime;
          this.auditService.log({
            userId: user?.id,
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

    // Find the last non-UUID segment for nested resources
    // e.g. /contracts/uuid/payments → "payments"
    // e.g. /products/uuid → "products"
    // e.g. /auth/login → "auth"
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Walk backwards to find the last meaningful entity name
    for (let i = parts.length - 1; i >= 0; i--) {
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
    const sanitized = { ...body };
    for (const field of AuditInterceptor.SENSITIVE_FIELDS) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }
    // Remove any base64 image data to keep logs small
    for (const [key, value] of Object.entries(sanitized)) {
      if (typeof value === 'string' && value.startsWith('data:image/')) {
        sanitized[key] = '[IMAGE_DATA]';
      }
      if (Array.isArray(value)) {
        sanitized[key] = value.map((v) =>
          typeof v === 'string' && v.startsWith('data:image/') ? '[IMAGE_DATA]' : v,
        );
      }
    }
    return sanitized;
  }
}
