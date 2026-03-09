import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  // Pre-compile regex patterns once at class level
  private static readonly suspiciousPatterns = [
    /<script\b[^>]*>/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /union\s+select/i,
    /;\s*drop\s+table/i,
    /--\s*$/,
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
    // Skip scanning for:
    // - Large payloads (e.g., base64 image uploads) to avoid CPU spikes
    // - OCR / file-upload routes that carry base64 data (false positives from base64 content)
    const skipScanPaths = ['/ocr/', '/product-photos', '/documents'];
    const shouldSkipScan = skipScanPaths.some(p => req.path.includes(p));

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
