import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * C2 — Payroll Custom Income/Deduction validation helpers (V16/V17/V18).
 *
 *   V16  Taxable Income = baseSalary + Σ(taxable customIncome).
 *        Non-taxable customIncome (ม.42 exempt) still Dr's the expense
 *        account but doesn't add to the WHT base.
 *   V17  Every customIncome.accountCode must be on the whitelist sourced
 *        from `system_config.custom_income_accounts_whitelist` (JSON array).
 *        Default `["53-1104","53-1105"]` is seeded by the migration; owner
 *        can override via /settings UI.
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

  async loadWhitelist(): Promise<Set<string>> {
    const row = await this.prisma.systemConfig.findUnique({
      where: { key: 'custom_income_accounts_whitelist' },
    });
    if (!row) return new Set(['53-1104', '53-1105']);
    try {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((v): v is string => typeof v === 'string'));
      }
    } catch {
      // fall through to default
    }
    return new Set(['53-1104', '53-1105']);
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
