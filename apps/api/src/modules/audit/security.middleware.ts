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
    /union\s+select/i,
    /;\s*drop\s+table/i,
    /--\s*$/,
  ];

  // Paths that carry HTML/base64 content and would false-positive on XSS patterns
  private static readonly skipScanPaths = [
    '/ocr/',
    '/product-photos',
    '/documents',
    '/contracts/',
    '/contract-templates',
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
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'",
    );
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );

    // Block suspicious payloads (basic XSS/injection prevention)
    // Skip scanning for routes that carry base64 or HTML content (false positives)
    const reqUrl = req.originalUrl || req.path || '';
    const shouldSkipScan = SecurityMiddleware.skipScanPaths.some(p => reqUrl.includes(p));

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
