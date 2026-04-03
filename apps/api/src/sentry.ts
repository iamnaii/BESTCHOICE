import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    // Don't send PII (Thai national IDs, phone numbers) to Sentry
    beforeSend(event) {
      if (event.request?.data) {
        const data = event.request.data as Record<string, unknown>;
        const sensitiveKeys = ['nationalId', 'password', 'phone', 'signatureImage'];
        for (const key of sensitiveKeys) {
          if (key in data) data[key] = '[REDACTED]';
        }
      }
      return event;
    },
  });
}
