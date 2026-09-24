import * as Sentry from '@sentry/nestjs';
import { redactShareToken } from './utils/redact-share-token.util';

const dsn = process.env.SENTRY_DSN;

/**
 * fix round 2 finding 1(a): `@sentry/nestjs`'s `requestDataIntegration` (on by
 * default, `url: true`) independently copies the CURRENT request's raw URL onto
 * `event.request.url` for every captured event — including ones the GFIN public
 * share-link routes (`GET/POST /api/g/<token>/...`) throw a 5xx on (e.g. the
 * `ServiceUnavailableException` `reply()` throws when `PII_HASH_SALT` is
 * missing). `SentryExceptionFilter`'s own `extra.url` scrub (fix round 1) never
 * touches this field, so the raw bearer token still reached Sentry through it.
 * Exported so a unit test can exercise it directly with a fake event.
 */
export function scrubShareTokenFromEvent(url: string | undefined): string | undefined {
  return typeof url === 'string' ? redactShareToken(url) : url;
}

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
      if (event.request?.url) {
        event.request.url = scrubShareTokenFromEvent(event.request.url);
      }
      if (event.extra?.url && typeof event.extra.url === 'string') {
        event.extra.url = scrubShareTokenFromEvent(event.extra.url);
      }
      if (Array.isArray(event.breadcrumbs)) {
        for (const crumb of event.breadcrumbs) {
          const data = crumb?.data as Record<string, unknown> | undefined;
          if (data && typeof data.url === 'string') {
            data.url = scrubShareTokenFromEvent(data.url);
          }
        }
      }
      return event;
    },
    // fix round 2 finding 1(a): `tracesSampleRate` samples ~20% of routine
    // `/api/g/<token>` requests as APM transactions in production — a SEPARATE
    // event type from errors, but one that also carries `event.request.url`
    // AND `event.transaction` (the route name/pattern), either of which can
    // carry the raw token depending on how Express names the route.
    beforeSendTransaction(event) {
      if (event.request?.url) {
        event.request.url = scrubShareTokenFromEvent(event.request.url);
      }
      if (typeof event.transaction === 'string') {
        event.transaction = redactShareToken(event.transaction);
      }
      return event;
    },
  });
}
