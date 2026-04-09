import { Injectable, Logger } from '@nestjs/common';

/**
 * StructuredLoggerService — wraps NestJS Logger with JSON-structured output.
 *
 * Usage:
 *   private readonly structuredLogger = new StructuredLoggerService(MyService.name);
 *
 * Services may set a persistent context (e.g. requestId, branchId) once and
 * all subsequent log calls will include it automatically.
 *
 * This is ADDITIVE — existing `this.logger` (NestJS Logger) calls are unchanged.
 */
@Injectable()
export class StructuredLoggerService {
  private readonly logger: Logger;
  private context: Record<string, unknown> = {};

  constructor(name: string) {
    this.logger = new Logger(name);
  }

  /** Merge additional key-value pairs into the persistent log context. */
  setContext(ctx: Record<string, unknown>) {
    this.context = { ...this.context, ...ctx };
  }

  log(message: string, data?: Record<string, unknown>) {
    this.logger.log(this.format(message, data));
  }

  warn(message: string, data?: Record<string, unknown>) {
    this.logger.warn(this.format(message, data));
  }

  error(message: string, data?: Record<string, unknown>) {
    this.logger.error(this.format(message, data));
  }

  debug(message: string, data?: Record<string, unknown>) {
    this.logger.debug(this.format(message, data));
  }

  private format(message: string, data?: Record<string, unknown>): string {
    const payload: Record<string, unknown> = {
      ...this.context,
      ...data,
      message,
      timestamp: new Date().toISOString(),
    };
    return JSON.stringify(payload);
  }
}
