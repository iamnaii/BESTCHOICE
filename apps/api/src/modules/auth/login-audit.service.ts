import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

export type LoginFailureKind =
  | 'wrong_password'
  | 'user_not_found'
  | 'account_locked'
  | 'account_disabled'
  | '2fa_invalid'
  | 'other';

export interface LoginAuditInput {
  userId?: string | null;
  emailTried: string;
  success: boolean;
  failureKind?: LoginFailureKind;
  ipAddress?: string;
  userAgent?: string;
  twoFactorUsed?: boolean;
}

/**
 * Fire-and-forget audit writer for auth attempts. Must never block the login
 * path, must never throw. If the table is gone or the DB is wedged, we still
 * want the user to be able to sign in (or not) on the path they're on.
 */
@Injectable()
export class LoginAuditService {
  private readonly logger = new Logger(LoginAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: LoginAuditInput): Promise<void> {
    try {
      await this.prisma.loginAuditLog.create({
        data: {
          userId: entry.userId ?? null,
          emailTried: entry.emailTried.slice(0, 320),
          success: entry.success,
          failureKind: entry.failureKind ?? null,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ? entry.userAgent.slice(0, 500) : null,
          twoFactorUsed: entry.twoFactorUsed ?? false,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to persist login audit: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, { tags: { module: 'auth', action: 'login_audit' } });
    }
  }
}
