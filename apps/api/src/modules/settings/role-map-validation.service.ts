import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountRoleService } from '../journal/account-role.service';

/**
 * D1.1.1.5 — Validation rules for `account_role_map` mutations.
 * Pulled out of `AccountRoleService.update()` so other entry points
 * (future POST, bulk-import) can reuse the same checks.
 *
 * Three rules:
 * 1. **Required-role lock** — REQUIRED_ROLES rows cannot be deactivated.
 *    Boot-time invariants in `AccountRoleService.assertRequiredRolesPresent`
 *    would fail on the next deploy.
 * 2. **CoA presence + normalBalance match** — accountCode must exist in
 *    `chart_of_accounts` AND its `normalBalance` must match the expected
 *    side for that role (e.g. `vat_input` expects Dr-side). Catches the
 *    "OWNER pasted the wrong code" class of bug before it lands in a JE.
 * 3. **Priority uniqueness per role** — multiple rows can share the same
 *    `role` (context-aware lookup), but each must use a distinct `priority`
 *    so the cache load can pick a deterministic winner. The unique index
 *    on `(role, accountCode)` alone doesn't enforce this.
 */
@Injectable()
export class RoleMapValidationService {
  /**
   * Expected normal balance per role. Codes outside this map are accepted
   * with either Dr/Cr (free-form). Add new roles as they appear in
   * `account_role_map`.
   *
   * - assets (sit on Dr side) → 'Dr'
   * - liabilities + revenue + contra-assets → 'Cr'
   * - expenses (Dr side) → 'Dr'
   */
  static readonly EXPECTED_NORMAL_BALANCE: Record<string, 'Dr' | 'Cr'> = {
    // VAT input — asset (Dr)
    vat_input: 'Dr',
    vat_input_pending: 'Dr',
    // VAT output — liability (Cr)
    vat_output: 'Cr',
    // Payables — liability (Cr)
    payable_default: 'Cr',
    payable_canva: 'Cr',
    // WHT payables — liability (Cr)
    wht_individual: 'Cr',
    wht_juristic: 'Cr',
    wht_payroll: 'Cr',
    wht_dividend: 'Cr',
    // SSO payables — liability (Cr)
    sso_employee: 'Cr',
    sso_employer: 'Cr',
    // Payroll expenses — expense (Dr)
    payroll_expense: 'Dr',
    payroll_sso_expense: 'Dr',
    payroll_overtime: 'Dr',
    payroll_bonus: 'Dr',
    // Payroll deduction — other income (Cr)
    payroll_deduction: 'Cr',
    // Employee bond — liability (Cr)
    employee_bond: 'Cr',
    // Adjustment routes — both expense-side accounts on Dr,
    // overpay account (53-1503) on Dr too (income-or-expense combo line)
    adj_overpay: 'Dr',
    adj_underpay: 'Dr',
  };

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate a proposed update against rules 1+2+3. Throws BadRequest
   * with a Thai message on failure. Pass `currentRow` so we can skip
   * checks for unchanged fields.
   */
  async validateUpdate(args: {
    id: string;
    currentRow: {
      id: string;
      role: string;
      accountCode: string;
      priority: number;
      isActive: boolean;
    };
    update: {
      accountCode?: string;
      priority?: number;
      isActive?: boolean;
    };
  }): Promise<void> {
    const { currentRow, update } = args;

    // Rule 1 — required-role lock.
    if (
      update.isActive === false &&
      AccountRoleService.getRequiredRoles().includes(currentRow.role)
    ) {
      throw new BadRequestException(
        `Role "${currentRow.role}" จำเป็นสำหรับการทำงานของระบบ — ห้ามปิดใช้งาน`,
      );
    }

    // Rule 2a — CoA presence (only when accountCode is changing).
    const newCode = update.accountCode;
    if (newCode && newCode !== currentRow.accountCode) {
      const coa = await this.prisma.chartOfAccount.findFirst({
        where: { code: newCode, deletedAt: null },
        select: { code: true, normalBalance: true },
      });
      if (!coa) {
        throw new BadRequestException(`บัญชี ${newCode} ไม่พบในผังบัญชี`);
      }
      // Rule 2b — normalBalance must match the role's expected side.
      const expected = RoleMapValidationService.EXPECTED_NORMAL_BALANCE[currentRow.role];
      if (expected && coa.normalBalance !== expected) {
        throw new BadRequestException(
          `Role "${currentRow.role}" ต้องใช้บัญชีฝั่ง ${expected} — ` +
            `แต่บัญชี ${newCode} อยู่ฝั่ง ${coa.normalBalance}`,
        );
      }
    }

    // Rule 3 — priority uniqueness within (role).
    if (update.priority !== undefined && update.priority !== currentRow.priority) {
      const conflict = await this.prisma.accountRoleMap.findFirst({
        where: {
          role: currentRow.role,
          priority: update.priority,
          NOT: { id: currentRow.id },
        },
        select: { id: true },
      });
      if (conflict) {
        throw new BadRequestException(
          `Priority ${update.priority} ถูกใช้แล้วใน role "${currentRow.role}" — เลือกค่าอื่น`,
        );
      }
    }
  }
}
