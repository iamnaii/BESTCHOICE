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
  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, user } = request;

    // Only audit mutating operations
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.auditService.log({
            userId: user?.id,
            action: method,
            entity: this.extractEntity(url),
            entityId: this.extractEntityId(url),
            newValue: this.sanitizeBody(body),
            ipAddress: request.ip || request.headers['x-forwarded-for'],
            userAgent: request.headers['user-agent'],
          });
        },
        error: (err) => {
          this.auditService.log({
            userId: user?.id,
            action: `${method}_ERROR`,
            entity: this.extractEntity(url),
            entityId: this.extractEntityId(url),
            newValue: {
              error: err.message,
              duration: Date.now() - startTime,
            },
            ipAddress: request.ip || request.headers['x-forwarded-for'],
            userAgent: request.headers['user-agent'],
          });
        },
      }),
    );
  }

  private extractEntity(url: string): string {
    const parts = url.replace(/^\/api\//, '').split('/');
    return parts[0] || 'unknown';
  }

  private extractEntityId(url: string): string | undefined {
    const parts = url.replace(/^\/api\//, '').split('/');
    // UUID pattern
    const uuidPart = parts.find((p) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p),
    );
    return uuidPart;
  }

  private sanitizeBody(body: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!body || Object.keys(body).length === 0) return undefined;
    const sanitized = { ...body };
    // Remove sensitive fields
    const sensitiveFields = ['password', 'token', 'secret', 'accessToken', 'refreshToken'];
    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }
    return sanitized;
  }
}
