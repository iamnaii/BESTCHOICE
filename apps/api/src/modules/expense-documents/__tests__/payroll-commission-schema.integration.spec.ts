import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * D4 part 2 Task 1 — สิ่งที่ dmmf มองไม่เห็น (SQL-only): partial unique index · แถว CoA S51-1101 · แถว role
 * รัน: bash tools/test-db-vitest.sh src/modules/expense-documents/__tests__/payroll-commission-schema.integration.spec.ts
 */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describe('payroll commission schema (migrations only)', () => {
  it('partial unique index exists with the PAY/live predicate', async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'payroll_commission_items_one_active_pay'`;
    expect(rows).toHaveLength(1);
    const def = rows[0].indexdef;
    expect(def).toContain('UNIQUE');
    expect(def).toContain('sales_commission_id');
    expect(def).toMatch(/WHERE.*kind.*PAY/);
    expect(def).toMatch(/released_at IS NULL/);
  });

  it('S51-1101 CoA row and the single SHOP role row exist', async () => {
    const coa = await prisma.chartOfAccount.findUnique({ where: { code: 'S51-1101' } });
    expect(coa).toMatchObject({ normalBalance: 'Dr', type: 'ค่าใช้จ่าย', deletedAt: null });
    const roles = await prisma.accountRoleMap.findMany({ where: { role: { in: ['shop_payroll_commission', 'payroll_commission'] } } });
    expect(roles.map((r) => `${r.role}:${r.accountCode}`)).toEqual(['shop_payroll_commission:S51-1101']);
  });

  it('payroll_custom_deduction.source defaults to MANUAL', async () => {
    const rows = await prisma.$queryRaw<{ column_default: string; is_nullable: string }[]>`
      SELECT column_default, is_nullable FROM information_schema.columns
      WHERE table_name = 'payroll_custom_deduction' AND column_name = 'source'`;
    expect(rows[0].is_nullable).toBe('NO');
    expect(rows[0].column_default).toContain('MANUAL');
  });
});
