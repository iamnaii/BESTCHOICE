import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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
      throw new BadRequestException(
        `SSO ต่อคนไม่เกิน ${cap.toFixed(2)} บาท/เดือน (5% × ${cfg.salaryCeiling.toFixed(0)} เพดาน, มีผล ${cfg.effectiveFrom.toISOString().slice(0, 10)})`,
      );
    }
  }
}
