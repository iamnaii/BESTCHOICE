import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
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
    if (req.body && typeof req.body === 'object') {
      const bodyStr = JSON.stringify(req.body);
      const suspiciousPatterns = [
        /<script\b[^>]*>/i,
        /javascript:/i,
        /on\w+\s*=/i,
        /union\s+select/i,
        /;\s*drop\s+table/i,
        /--\s*$/,
      ];
      for (const pattern of suspiciousPatterns) {
        if (pattern.test(bodyStr)) {
          throw new HttpException(
            'Invalid request payload',
            HttpStatus.BAD_REQUEST,
          );
        }
      }
    }

    next();
  }
}
