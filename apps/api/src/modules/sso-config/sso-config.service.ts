import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * D1.1.3.3 — Thai Social Security contribution rate is **fixed at 5%** by
 * Thai Social Security Act §46 + the ministerial regulation issued under it
 * (พ.ร.บ.ประกันสังคม พ.ศ. 2533 มาตรา 46 ประกอบกฎกระทรวง). §46 gives the
 * Minister authority to set the rate within statutory bounds; the actual
 * 5% figure lives in the กฎกระทรวง (ministerial regulation), not the Act
 * itself. §47 covers maximum benefit amounts and is NOT relevant to the
 * contribution rate. Both employee and employer sides contribute 5%.
 *
 * The 750-฿/person/month cap is enforced separately via
 * `SsoConfig.maxContribution` (period-effective: 875 in 2569+, 1000 in
 * 2572+, 1150 in 2575+).
 *
 * DO NOT make this configurable — change the กฎกระทรวง first. The rate is
 * exposed as a `sso_rate_locked` UI flag (string "5%") so OWNER sees it as
 * informational, but the SystemConfig key is read-only (writes rejected).
 *
 * If you ever find yourself wanting to bump this constant, you almost
 * certainly mean to override the per-line `ssoEmployee` amount on a
 * specific PayrollLine, NOT the global rate.
 */
export const SSO_RATE = 0.05 as const;

export interface SsoConfigResult {
  id: string;
  salaryCeiling: Prisma.Decimal;
  maxContribution: Prisma.Decimal;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

@Injectable()
export class SsoConfigService {
  constructor(private prisma: PrismaService) {}

  /**
   * Find the SsoConfig row whose effective period covers `date`.
   * Throws NotFoundException if no row matches (means seed is broken or
   * date is before the earliest configured period).
   */
  async getEffectiveConfig(date: Date): Promise<SsoConfigResult> {
    const row = await this.prisma.ssoConfig.findFirst({
      where: {
        deletedAt: null,
        isActive: true,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!row) {
      throw new NotFoundException(
        `ไม่พบ SSO config สำหรับวันที่ ${date.toISOString().slice(0, 10)} — ตรวจ seed migration 20260927000000_sso_config_table`,
      );
    }

    return row;
  }

  /**
   * Validate that `ssoEmployee` does not exceed the contribution cap for `date`.
   * Pass-through if `ssoEmployee` is null/undefined/0 (lines without SSO).
   * Throws BadRequestException with Thai message if over cap.
   */
  async validateContribution(date: Date, ssoEmployee: number | undefined | null): Promise<void> {
    if (ssoEmployee == null || ssoEmployee <= 0) return;

    const cfg = await this.getEffectiveConfig(date);
    const cap = cfg.maxContribution.toNumber();

    if (ssoEmployee > cap) {
      const ratePct = (SSO_RATE * 100).toFixed(0);
      throw new BadRequestException(
        `SSO ต่อคนไม่เกิน ${cap.toFixed(2)} บาท/เดือน (${ratePct}% × ${cfg.salaryCeiling.toFixed(0)} เพดาน, มีผล ${cfg.effectiveFrom.toISOString().slice(0, 10)})`,
      );
    }
  }
}
