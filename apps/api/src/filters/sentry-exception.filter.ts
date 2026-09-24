import { Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';
import { redactShareToken } from '../utils/redact-share-token.util';

// GFIN share-link routes embed a 256-bit bearer token directly in the URL path
// (`/api/g/<43-char-token>/...`) — the token IS the credential, so it must never
// reach a log line or Sentry event verbatim. The controller (finance-share-public.controller.ts)
// already catches its own expected errors before they get here, but this is the
// backstop: ANY unhandled 5xx on ANY route gets its URL redacted before it's
// logged/reported, so a future bug elsewhere can't leak a share token either
// (fix round 1 CRITICAL finding 1c).
// fix round 2 finding 1(a): the redaction fn itself moved to a shared util so
// `sentry.ts` (loaded via `require()` before Nest boots — see main.ts) can reuse
// the EXACT same pattern for `beforeSend`/`beforeSendTransaction`, which is where
// @sentry/nestjs's own `requestDataIntegration` sneaks the raw URL back in.
/** Re-exported so this file's existing import path (used by call sites + its spec) still works. */
export { redactShareToken };

/**
 * Global exception filter that:
 * 1. Reports unhandled exceptions to Sentry
 * 2. Returns consistent error response format
 * 3. Redacts sensitive data from error responses
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(SentryExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    // Determine HTTP status and message
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'เกิดข้อผิดพลาดภายในระบบ';
    let errorCode = 'INTERNAL_ERROR';
    // Structured detail a 4xx carries that the web reads to drive its own UX,
    // so it must survive the rewrite below — explicit allow-list, never a
    // spread of the whole response (the filter's redaction intent stands):
    //  - `errors` (e.g. other-income `[{ rule, msg }]`) — DOC-05 #1564: every
    //    rule failure used to reach the client as the bare message.
    //  - `existingCustomer` / `field` (customer-write.service.ts duplicate
    //    ConflictExceptions) — R47: CustomerCreateDialog/useOcrFlow's
    //    "รวมกับลูกค้าเดิมคนนี้" merge UX never fired against the real API
    //    because both keys were dropped here.
    const details: { errors?: unknown[]; existingCustomer?: unknown; field?: unknown } = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp.message as string) || message;
        errorCode = (resp.error as string) || errorCode;
        if (status < 500) {
          if (Array.isArray(resp.errors)) details.errors = resp.errors;
          if (resp.existingCustomer !== undefined) details.existingCustomer = resp.existingCustomer;
          if (resp.field !== undefined) details.field = resp.field;
        }
      }
    }

    // Only report 5xx errors to Sentry (not 4xx client errors)
    if (status >= 500) {
      const safeUrl = redactShareToken(request.url);
      Sentry.captureException(exception, {
        extra: {
          url: safeUrl,
          method: request.method,
          userId: request.user?.id,
          userRole: request.user?.role,
        },
      });
      this.logger.error(
        `${request.method} ${safeUrl} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // Don't leak internal details in production
    if (status >= 500 && process.env.NODE_ENV === 'production') {
      message = 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง';
    }

    response.status(status).json({
      statusCode: status,
      message,
      error: errorCode,
      ...details,
      timestamp: new Date().toISOString(),
    });
  }
}
