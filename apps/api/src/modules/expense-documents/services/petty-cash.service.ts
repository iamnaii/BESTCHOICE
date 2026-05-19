import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export interface PettyCashConfig {
  /**
   * Float account code (Cr side of every JE). Default 11-1103 (เงินสดพนักงานบัญชี
   * — Imprest Fund pattern, per Owner Response Q1 signed 2026-05-17). Migration
   * 20260955000000_owner_q1q8_systemconfig_decisions seeds this into prod;
   * the default here is defense in depth for fresh / un-migrated DBs.
   */
  account: string;
  /** Max total per document. Default 5000฿. Set via system_config `petty_cash_limit`. */
  limit: Prisma.Decimal;
  /** Replenish alert threshold (advisory, not enforced). */
  replenishThreshold: Prisma.Decimal | null;
}

/**
 * Petty Cash service — reads policy from SystemConfig + supplies the V20
 * validator with the effective `limit` / `account` for a given posting.
 * Defaults match accounting.md when SystemConfig rows are absent (admin can
 * override via /settings UI per A1.1.5).
 */
@Injectable()
export class PettyCashService {
  constructor(private prisma: PrismaService) {}

  async getConfig(): Promise<PettyCashConfig> {
    const rows = await this.prisma.systemConfig.findMany({
      where: {
        key: {
          in: [
            'petty_cash_account',
            'petty_cash_limit',
            'petty_cash_replenish_threshold',
          ],
        },
        deletedAt: null,
      },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    return {
      account: byKey.get('petty_cash_account') ?? '11-1103',
      limit: new Prisma.Decimal(byKey.get('petty_cash_limit') ?? '5000'),
      replenishThreshold:
        byKey.has('petty_cash_replenish_threshold')
          ? new Prisma.Decimal(byKey.get('petty_cash_replenish_threshold')!)
          : null,
    };
  }

  /** Reload config — used by tests + future cache-invalidation flow. */
  async refresh(): Promise<PettyCashConfig> {
    return this.getConfig();
  }

  /**
   * V20 invariants:
   *   V20.1  total ≤ petty_cash_limit
   *   V20.2  every line has supplier_name (already DTO-enforced; defense-in-depth)
   *   V20.3  depositAccountCode === petty_cash_account
   */
  validate(
    opts: {
      total: Prisma.Decimal;
      depositAccountCode: string;
      lines: { supplierName: string }[];
    },
    config: PettyCashConfig,
  ): void {
    // V20.1 — total cap
    if (opts.total.gt(config.limit)) {
      throw new BadRequestException(
        `V20: ยอดรวม Petty Cash (${opts.total.toFixed(2)} ฿) เกินวงเงินที่อนุญาต ` +
          `(${config.limit.toFixed(2)} ฿) — แยกเป็นหลายเอกสาร หรือเพิ่มวงเงินที่ /settings`,
      );
    }
    // V20.2 — every line has supplier_name (defense-in-depth)
    for (let i = 0; i < opts.lines.length; i++) {
      const s = opts.lines[i].supplierName;
      if (!s || !s.trim()) {
        throw new BadRequestException(
          `V20: รายการที่ ${i + 1}: ต้องระบุชื่อผู้ขาย/ผู้รับเงิน`,
        );
      }
    }
    // V20.3 — petty-cash account
    if (opts.depositAccountCode !== config.account) {
      throw new BadRequestException(
        `V20: Petty Cash ต้องใช้บัญชี ${config.account} (พบ ${opts.depositAccountCode}) — ` +
          `หากต้องการเปลี่ยน ให้แก้ system_config[petty_cash_account]`,
      );
    }
  }
}
