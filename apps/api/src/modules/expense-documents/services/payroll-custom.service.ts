import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CASH_ACCOUNT_CODES,
  SHOP_CASH_ACCOUNT_CODES,
} from '../../../constants/cash-account.constants';

/**
 * C2 — Payroll Custom Income/Deduction validation helpers (V16/V17/V18).
 *
 *   V16  Taxable Income = baseSalary + Σ(taxable customIncome).
 *        Non-taxable customIncome (ม.42 exempt) still Dr's the expense
 *        account but doesn't add to the WHT base.
 *   V17  Every customIncome.accountCode must be on the whitelist sourced
 *        from `system_config.custom_income_accounts_whitelist` (FINANCE) /
 *        `custom_income_accounts_whitelist_shop` (SHOP) — JSON arrays.
 *        Defaults: FINANCE `["53-1103","53-1104"]` (OT+โบนัส — B1 fix 2026-08-06),
 *        SHOP `["S52-1202","S52-1204"]`. Owner can override via SystemConfig.
 *   V18  Σ(customDeduction) ≤ baseSalary + Σ(customIncome). Prevents the
 *        payroll line from producing a negative net cash leg (which would
 *        mean the employee owes the employer instead of being paid).
 *
 * V16 is informational at validation time — the service consumer uses the
 * returned `taxableBase` to override the WHT base when running its own WHT
 * computation. V17/V18 throw `BadRequestException` on violation.
 */
@Injectable()
export class PayrollCustomService {
  constructor(private prisma: PrismaService) {}

  /**
   * Per-scope whitelist (คำสั่งเจ้าของ 2026-08-06 — payroll แยกฝั่ง SHOP/FINANCE):
   *   FINANCE → system_config.custom_income_accounts_whitelist
   *             default ['53-1103','53-1104'] (B1 fix — OT = 53-1103 ค่าล่วงเวลา,
   *             NOT 53-1105 ค่าอบรม สัมมนา as the old seed wrongly listed)
   *   SHOP    → system_config.custom_income_accounts_whitelist_shop
   *             default ['S52-1202','S52-1204'] (OT + โบนัส พนักงานสาขา)
   */
  async loadWhitelist(scope: 'SHOP' | 'FINANCE' = 'FINANCE'): Promise<Set<string>> {
    const key =
      scope === 'SHOP'
        ? 'custom_income_accounts_whitelist_shop'
        : 'custom_income_accounts_whitelist';
    const fallback =
      scope === 'SHOP' ? ['S52-1202', 'S52-1204'] : ['53-1103', '53-1104'];
    const row = await this.prisma.systemConfig.findUnique({ where: { key } });
    if (!row) return new Set(fallback);
    try {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((v): v is string => typeof v === 'string'));
      }
    } catch {
      // fall through to default
    }
    return new Set(fallback);
  }

  /**
   * Meta for the payroll form (UI stops hardcoding the whitelist — B1 root
   * cause was a web-side hardcode drifting from the seed): whitelist + cash
   * accounts of the requested scope, with CoA names for display.
   */
  async getMeta(scope: 'SHOP' | 'FINANCE') {
    const whitelist = [...(await this.loadWhitelist(scope))].sort();
    const cashCodes =
      scope === 'SHOP' ? [...SHOP_CASH_ACCOUNT_CODES] : [...CASH_ACCOUNT_CODES];
    const rows = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: [...whitelist, ...cashCodes] }, deletedAt: null },
      select: { code: true, name: true },
    });
    const nameMap = new Map(rows.map((r) => [r.code, r.name]));
    return {
      scope,
      incomeWhitelist: whitelist.map((code) => ({ code, name: nameMap.get(code) ?? code })),
      cashAccounts: cashCodes.map((code) => ({ code, name: nameMap.get(code) ?? code })),
    };
  }

  /**
   * V19 (2026-08-06) — custom-deduction account codes must (a) exist in the
   * chart of accounts and (b) belong to the document's scope partition
   * (SHOP → S-prefixed, FINANCE → bare digits). Deductions stay
   * employer-discretion (no whitelist), but a typo like 99-9999 now fails at
   * create time with a Thai message instead of exploding at post time.
   */
  async validateDeductionAccounts(
    codes: string[],
    scope: 'SHOP' | 'FINANCE',
  ): Promise<void> {
    const unique = [...new Set(codes)];
    if (unique.length === 0) return;

    const wrongScope = unique.filter((c) =>
      scope === 'SHOP' ? !c.startsWith('S') : c.startsWith('S'),
    );
    if (wrongScope.length > 0) {
      throw new BadRequestException(
        `V19: บัญชีรายการหัก ${wrongScope.join(', ')} ไม่ตรงฝั่งของเอกสาร (${scope}) — ` +
          (scope === 'SHOP'
            ? 'เอกสารเงินเดือนพนักงานสาขาต้องใช้บัญชีผัง SHOP (ขึ้นต้น S เช่น S11-XXXX)'
            : 'เอกสารเงินเดือนส่วนกลางต้องใช้บัญชีผัง FINANCE (ตัวเลขล้วน เช่น 11-XXXX)'),
      );
    }

    const found = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: unique }, deletedAt: null },
      select: { code: true },
    });
    const foundSet = new Set(found.map((r) => r.code));
    const missing = unique.filter((c) => !foundSet.has(c));
    if (missing.length > 0) {
      throw new BadRequestException(
        `V19: ไม่พบบัญชีรายการหัก ${missing.join(', ')} ในผังบัญชี — กรุณาตรวจรหัสบัญชี`,
      );
    }
  }

  /**
   * V17 — every customIncome.accountCode must be on the whitelist.
   * V18 — Σ(deduction) must not exceed base + Σ(income).
   *
   * Returns the per-line `taxableBase` (V16 result) so the caller can use it
   * as the WHT base override. taxableBase = baseSalary + Σ(taxable income).
   *
   * Pure function modulo the whitelist DB read; safe to call inside a
   * `prisma.$transaction`.
   */
  async validateLine(
    line: {
      employeeName: string;
      baseSalary: number | Prisma.Decimal;
      customIncome?: { accountCode: string; amount: number | Prisma.Decimal; isTaxable?: boolean }[];
      customDeduction?: { accountCode: string; amount: number | Prisma.Decimal }[];
    },
    whitelist: Set<string>,
  ): Promise<{ taxableBase: Prisma.Decimal }> {
    const base = new Prisma.Decimal(line.baseSalary);
    const incomeRows = line.customIncome ?? [];
    const deductionRows = line.customDeduction ?? [];

    // V17 — whitelist enforcement
    for (let i = 0; i < incomeRows.length; i++) {
      const row = incomeRows[i];
      if (!whitelist.has(row.accountCode)) {
        throw new BadRequestException(
          `V17: บัญชีรายได้พิเศษ ${row.accountCode} ของพนักงาน "${line.employeeName}" ` +
            `แถวที่ ${i + 1} ไม่อยู่ในรายการที่อนุญาต — ` +
            `อนุญาตเฉพาะ ${[...whitelist].sort().join(', ')} ` +
            `(แก้ได้ที่ system_config.custom_income_accounts_whitelist)`,
        );
      }
    }

    const sumIncome = incomeRows.reduce<Prisma.Decimal>(
      (s, r) => s.plus(new Prisma.Decimal(r.amount)),
      new Prisma.Decimal(0),
    );
    const sumDeduction = deductionRows.reduce<Prisma.Decimal>(
      (s, r) => s.plus(new Prisma.Decimal(r.amount)),
      new Prisma.Decimal(0),
    );

    // V18 — Σ(deduction) ≤ base + Σ(income)
    const grossPay = base.plus(sumIncome);
    if (sumDeduction.gt(grossPay)) {
      throw new BadRequestException(
        `V18: ผลรวมรายการหัก (${sumDeduction.toFixed(2)} ฿) ของพนักงาน "${line.employeeName}" ` +
          `เกินรายได้รวมก่อนหัก (${grossPay.toFixed(2)} ฿ = base + รายได้พิเศษ) — ` +
          `ผลลัพธ์จะติดลบ ไม่สามารถจ่ายเงินเดือนได้`,
      );
    }

    // V16 — taxable base = base + Σ(taxable income only)
    const taxableBase = incomeRows
      .filter((r) => r.isTaxable !== false) // default true
      .reduce<Prisma.Decimal>(
        (s, r) => s.plus(new Prisma.Decimal(r.amount)),
        base,
      );

    return { taxableBase };
  }
}
