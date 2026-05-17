import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * D1.3.3.1 — server-side gate for data-export endpoints (PDF / Excel / CSV).
 *
 * Reads SystemConfig key `export_enabled` directly via PrismaService so this
 * guard can be applied without forcing every host module to import
 * SettingsModule (mirrors the lean pattern from PR #884's readBoolFlag).
 *
 * Decision matrix:
 * - Flag absent or any non-`'false'` value → allow (default true)
 * - Flag explicitly `'false'` / `'0'`      → throw ForbiddenException (HTTP 403)
 * - Transient DB error during read         → **fail-CLOSED** (S1 security fix)
 *
 * Rationale for fail-CLOSED: an export endpoint that silently flips back to
 * "allowed" on DB outage defeats the entire purpose of the kill-switch. If
 * the DB is unreachable we cannot prove the flag is currently `true`, so the
 * safe default is to refuse. Sentry alarms + structured log on the catch
 * branch let ops triage the outage.
 *
 * Blocked attempts also write an `EXPORT_BLOCKED` AuditLog row (S4 / PDPA)
 * so we have a tamper-evident record of denied exports.
 *
 * The frontend should also hide export-buttons via `useUiFlags().exportEnabled`
 * — this guard is the defence-in-depth so disabling the flag actually stops
 * download attempts that bypass the UI (curl, scripts, stale tabs).
 */
@Injectable()
export class ExportEnabledGuard implements CanActivate {
  private readonly logger = new Logger(ExportEnabledGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request?.user;
    const route: string =
      request?.originalUrl || request?.url || request?.route?.path || 'unknown';
    const method: string = request?.method || 'unknown';

    let allowed = true;
    let dbFailed = false;

    try {
      const row = await this.prisma.systemConfig.findFirst({
        where: { key: 'export_enabled', deletedAt: null },
        select: { value: true },
      });
      if (row?.value) {
        const v = row.value.trim().toLowerCase();
        if (v === 'false' || v === '0') allowed = false;
      }
    } catch (err) {
      // S1 — fail-CLOSED on DB outage.
      // We cannot confirm the flag is currently `true`; the secure default
      // is to refuse the export so a transient DB failure cannot bypass an
      // active kill-switch.
      dbFailed = true;
      allowed = false;
      Sentry.captureException(err, {
        tags: { context: 'export-enabled-guard', failure_mode: 'fail-closed' },
        extra: { route, method },
      });
      this.logger.error(
        `Failed to read export_enabled flag — failing closed (route=${method} ${route})`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    if (!allowed) {
      // S4 — AuditLog write on block (PDPA / compliance trail).
      // Best-effort: never let an audit-log failure mask the 403, and never
      // let it secondarily mask a primary DB outage that we already logged.
      try {
        if (user?.id) {
          await this.prisma.auditLog.create({
            data: {
              userId: user.id,
              action: 'EXPORT_BLOCKED',
              entity: 'system_config',
              entityId: 'export_enabled',
              ipAddress:
                request?.ip ||
                request?.headers?.['x-forwarded-for'] ||
                undefined,
              newValue: {
                route,
                method,
                reason: dbFailed
                  ? 'fail-closed (config read error)'
                  : 'export_enabled=false',
              },
            },
          });
        }
      } catch (auditErr) {
        // Don't surface to client; only Sentry the audit failure.
        Sentry.captureException(auditErr, {
          tags: { context: 'export-enabled-guard', failure_mode: 'audit-write' },
        });
        this.logger.warn(
          'Failed to persist EXPORT_BLOCKED audit log (non-fatal)',
          auditErr instanceof Error ? auditErr.stack : String(auditErr),
        );
      }

      throw new ForbiddenException(
        dbFailed
          ? 'ระบบไม่สามารถยืนยันสิทธิ์การส่งออกได้ — โปรดลองอีกครั้ง หรือติดต่อผู้ดูแลระบบ'
          : 'การส่งออกข้อมูลถูกปิดใช้งานชั่วคราว — โปรดติดต่อผู้ดูแลระบบ',
      );
    }
    return true;
  }
}
