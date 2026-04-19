import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { AuditService } from './audit.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { tap } = require('rxjs');

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private static readonly SENSITIVE_FIELDS = [
    // Auth credentials
    'password', 'token', 'secret', 'accessToken', 'refreshToken',
    'currentPassword', 'newPassword', 'confirmPassword',
    // PII — PDPA compliance
    'nationalId', 'vendorTaxId', 'taxId',
    'phone', 'mobilePhone', 'emergencyPhone',
    'email', 'lineId', 'lineUserId',
    'address', 'currentAddress', 'registeredAddress',
    'bankAccount', 'bankAccountNumber', 'accountNumber',
    // T2-C15: integration secrets stored under SystemConfig or passed in
    // third-party webhook payloads. These leak through the audit log as
    // "newValue" otherwise.
    'bankApiKey', 'paymentGateway', 'peakSecretKey', 'mdmApiKey',
    'connectId', 'userToken', 'appSecret', 'webhookSecret',
    'secretKey', 'smsApiSecret',
  ];

  /**
   * T2-C15: pattern-match catch-all for secret-shaped keys we haven't
   * listed explicitly (e.g. `xyzApiKey`, `someSecret`, `myToken`). Keeps
   * us safe when new fields are added to SystemConfig without touching
   * this file.
   */
  private static readonly SENSITIVE_FIELD_PATTERNS: RegExp[] = [
    /secret/i,
    /apikey/i,
    /token/i,
  ];

  private static isSensitiveKey(key: string): boolean {
    if (AuditInterceptor.SENSITIVE_FIELDS.includes(key)) return true;
    return AuditInterceptor.SENSITIVE_FIELD_PATTERNS.some((re) => re.test(key));
  }

  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
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
          // Skip audit for unauthenticated requests (login, register) to avoid FK violation
          if (!user?.id) return;

          const duration = Date.now() - startTime;
          // Try to extract entityId from response for POST (create) operations
          let entityId = this.extractEntityId(url);
          if (!entityId && method === 'POST' && responseBody && typeof responseBody === 'object') {
            entityId = responseBody.id;
          }

          this.auditService.log({
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
          this.auditService.log({
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
    const sanitized = { ...body };
    // T2-C15: redact by exact name OR by regex match (e.g. xyzApiKey,
    // someSecret). Covers the SystemConfig integration-secrets surface
    // without having to enumerate every possible key.
    for (const key of Object.keys(sanitized)) {
      if (AuditInterceptor.isSensitiveKey(key)) {
        sanitized[key] = '[REDACTED]';
      }
    }
    for (const [key, value] of Object.entries(sanitized)) {
      if (sanitized[key] === '[REDACTED]') continue;
      if (typeof value === 'string' && value.startsWith('data:image/')) {
        sanitized[key] = '[IMAGE_DATA]';
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map((v) =>
          typeof v === 'string' && v.startsWith('data:image/') ? '[IMAGE_DATA]' : v,
        );
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Recurse into nested objects to sanitize sensitive fields
        sanitized[key] = this.sanitizeBody(value as Record<string, unknown>);
      }
    }
    return sanitized;
  }
}
