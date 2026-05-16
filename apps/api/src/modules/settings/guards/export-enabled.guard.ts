import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * D1.3.3.1 — server-side gate for data-export endpoints (PDF / Excel / CSV).
 *
 * Reads SystemConfig key `export_enabled` directly via PrismaService so this
 * guard can be applied without forcing every host module to import
 * SettingsModule (mirrors the lean pattern from PR #884's readBoolFlag).
 *
 * - Flag absent or `'true'`            → allow (default behaviour preserved)
 * - Flag explicitly `'false'`           → throw ForbiddenException (HTTP 403)
 * - Transient DB error during read     → fall through to allow (default)
 *
 * The frontend should also hide export-buttons via `useUiFlags().exportEnabled`
 * — this guard is the defence-in-depth so disabling the flag actually stops
 * download attempts that bypass the UI (curl, scripts, stale tabs).
 */
@Injectable()
export class ExportEnabledGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(_context: ExecutionContext): Promise<boolean> {
    let allowed = true;
    try {
      const row = await this.prisma.systemConfig.findFirst({
        where: { key: 'export_enabled', deletedAt: null },
        select: { value: true },
      });
      if (row?.value) {
        const v = row.value.trim().toLowerCase();
        if (v === 'false' || v === '0') allowed = false;
      }
    } catch {
      // On read failure fall through to the spec default (true).
      allowed = true;
    }
    if (!allowed) {
      throw new ForbiddenException('การส่งออกข้อมูลถูกปิดใช้งานชั่วคราว — โปรดติดต่อผู้ดูแลระบบ');
    }
    return true;
  }
}
