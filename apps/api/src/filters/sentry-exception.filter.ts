import { Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';

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

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp.message as string) || message;
        errorCode = (resp.error as string) || errorCode;
      }
    }

    // Only report 5xx errors to Sentry (not 4xx client errors)
    if (status >= 500) {
      Sentry.captureException(exception, {
        extra: {
          url: request.url,
          method: request.method,
          userId: request.user?.id,
          userRole: request.user?.role,
        },
      });
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
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
      timestamp: new Date().toISOString(),
    });
  }
}
