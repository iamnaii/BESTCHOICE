import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  // Pre-compile regex patterns once at class level
  // NOTE: These must not false-positive on legitimate data like base64, HTML templates, etc.
  private static readonly suspiciousPatterns = [
    /<script\b[^>]*>/i,
    /javascript\s*:/i,
    /\bon(click|load|error|mouseover|focus|blur|submit|change|input)\s*=/i,
    // SQL injection patterns below are kept as defense-in-depth only.
    // Prisma uses parameterized queries so these cannot reach the DB,
    // but flagging them helps detect malicious intent in audit logs.
    // NOTE: "--\s*$" was removed — it false-positives on Thai notes like "ชำระแล้ว -- แก้ไข"
    /union\s+select/i,
    /;\s*drop\s+table/i,
  ];

  // Paths that carry HTML/base64 content and would false-positive on XSS patterns
  // Also skip auth endpoints — login/refresh payloads are simple email+password, no need for regex scanning
  private static readonly skipScanPaths = [
    '/auth/login',
    '/auth/refresh',
    '/ocr/',
    '/product-photos',
    '/documents',
    '/contract-templates',
  ];

  // Regex patterns for paths that need precise matching (not broad prefix)
  // e.g. /contracts/:id/sign carries signature data but other /contracts/ routes should be scanned
  private static readonly skipScanPatterns = [
    /\/contracts\/[^/]+\/sign$/,
  ];

  use(req: Request, res: Response, next: NextFunction) {
    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'",
    );
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );

    // Block suspicious payloads (basic XSS/injection prevention)
    // Skip scanning for routes that carry base64 or HTML content (false positives)
    const reqUrl = req.originalUrl || req.path || '';
    const shouldSkipScan =
      SecurityMiddleware.skipScanPaths.some(p => reqUrl.includes(p)) ||
      SecurityMiddleware.skipScanPatterns.some(p => p.test(reqUrl));

    if (!shouldSkipScan && req.body && typeof req.body === 'object') {
      const contentLength = parseInt(req.headers['content-length'] || '0', 10);
      if (contentLength < 1_000_000) {
        const bodyStr = JSON.stringify(req.body);
        for (const pattern of SecurityMiddleware.suspiciousPatterns) {
          if (pattern.test(bodyStr)) {
            throw new HttpException(
              'Invalid request payload',
              HttpStatus.BAD_REQUEST,
            );
          }
        }
      }
    }

    next();
  }
}
