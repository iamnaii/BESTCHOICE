import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import {
  computeDeviceFingerprint,
  computeIpPrefix,
  humanReadableDeviceLabel,
} from '../../utils/device-fingerprint.util';

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
  acceptLanguage?: string;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly lineOaService: LineOaService,
  ) {}

  async record(entry: LoginAuditInput): Promise<void> {
    try {
      const ipPrefix = computeIpPrefix(entry.ipAddress);
      const fingerprint = computeDeviceFingerprint({
        userAgent: entry.userAgent,
        ipPrefix,
        acceptLanguage: entry.acceptLanguage,
      });

      let isNewDevice = false;

      // Only upsert known device on successful logins
      if (entry.success && entry.userId) {
        const existing = await this.prisma.knownDevice.findUnique({
          where: { userId_fingerprint: { userId: entry.userId, fingerprint } },
          select: { id: true },
        });

        isNewDevice = !existing;

        await this.prisma.knownDevice.upsert({
          where: { userId_fingerprint: { userId: entry.userId, fingerprint } },
          create: {
            userId: entry.userId,
            fingerprint,
            deviceLabel: humanReadableDeviceLabel(entry.userAgent),
            ipAddress: entry.ipAddress ?? null,
            loginCount: 1,
          },
          update: {
            loginCount: { increment: 1 },
            ipAddress: entry.ipAddress ?? null,
            lastSeenAt: new Date(),
          },
        });

        if (isNewDevice) {
          void this.notifyNewDeviceLogin({
            userId: entry.userId,
            ipPrefix,
            userAgent: entry.userAgent,
          });
        }
      }

      await this.prisma.loginAuditLog.create({
        data: {
          userId: entry.userId ?? null,
          emailTried: entry.emailTried.slice(0, 320),
          success: entry.success,
          failureKind: entry.failureKind ?? null,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ? entry.userAgent.slice(0, 500) : null,
          twoFactorUsed: entry.twoFactorUsed ?? false,
          deviceFingerprint: fingerprint,
          isNewDevice,
          twoFactorMethod: null,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to persist login audit: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, { tags: { module: 'auth', action: 'login_audit' } });
    }
  }

  /**
   * Fire-and-forget LINE alert for new device logins.
   * All errors are caught — audit failure must never block the login path.
   */
  private async notifyNewDeviceLogin(params: {
    userId: string;
    ipPrefix: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      const staffLineId = process.env.SHOP_STAFF_LINE_ID;
      if (!staffLineId) {
        this.logger.warn('SHOP_STAFF_LINE_ID not set — skipping new-device LINE alert');
        return;
      }

      const user = await this.prisma.user.findUnique({
        where: { id: params.userId },
        select: { email: true, name: true, role: true },
      });

      if (!user) return;

      const now = new Date();
      const bangkokTime = new Intl.DateTimeFormat('th-TH', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now);

      const deviceLabel = humanReadableDeviceLabel(params.userAgent);
      const message =
        `[แจ้งเตือน] พบการเข้าสู่ระบบจากอุปกรณ์ใหม่\n` +
        `ผู้ใช้: ${user.name} (${user.email})\n` +
        `บทบาท: ${user.role}\n` +
        `อุปกรณ์: ${deviceLabel}\n` +
        `IP prefix: ${params.ipPrefix}\n` +
        `เวลา: ${bangkokTime} (เวลาไทย)\n` +
        `หากไม่ใช่คุณ กรุณาติดต่อผู้ดูแลระบบทันที`;

      await this.lineOaService.pushMessage(staffLineId, [{ type: 'text', text: message }]);
    } catch (err) {
      this.logger.error(
        `Failed to send new-device LINE alert: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
