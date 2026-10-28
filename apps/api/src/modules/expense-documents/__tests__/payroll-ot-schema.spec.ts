import { Prisma } from '@prisma/client';
import { AccountRoleService } from '../../journal/account-role.service';

const model = (name: string) => {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === name);
  if (!m) throw new Error(`model ${name} missing`);
  return m;
};
const field = (m: string, f: string) => {
  const x = model(m).fields.find((y) => y.name === f);
  if (!x) throw new Error(`field ${m}.${f} missing`);
  return x;
};

describe('payroll OT part 1 schema contract', () => {
  it('PayrollIncomeSource enum values', () => {
    const e = Prisma.dmmf.datamodel.enums.find((x) => x.name === 'PayrollIncomeSource');
    expect(e?.values.map((v) => v.name)).toEqual(['MANUAL', 'ADJUSTMENT', 'ATTENDANCE_OT', 'ATTENDANCE_HOLIDAY', 'ATTENDANCE_HOLIDAY_OT', 'COMMISSION']);
  });

  it('PayrollCustomIncome new fields', () => {
    expect(field('PayrollCustomIncome', 'source')).toMatchObject({ type: 'PayrollIncomeSource', isRequired: true, hasDefaultValue: true, default: 'MANUAL' });
    for (const f of ['quantity', 'rate', 'multiplier']) {
      expect(field('PayrollCustomIncome', f)).toMatchObject({ type: 'Decimal', isRequired: false });
    }
  });

  it('PayrollLine new fields', () => {
    expect(field('PayrollLine', 'lineNo')).toMatchObject({ type: 'Int', isRequired: true, hasDefaultValue: true, default: 0 });
    expect(field('PayrollLine', 'systemPulledAt')).toMatchObject({ type: 'DateTime', isRequired: false });
    expect(field('PayrollLine', 'attendanceSummary')).toMatchObject({ type: 'Json', isRequired: false });
    expect(field('PayrollLine', 'systemNotes')).toMatchObject({ type: 'Json', isRequired: false });
  });

  it('REQUIRED_ROLES has both holiday roles', () => {
    const roles = (AccountRoleService as unknown as { REQUIRED_ROLES: string[] }).REQUIRED_ROLES;
    expect(roles).toEqual(expect.arrayContaining(['shop_payroll_holiday', 'payroll_holiday']));
  });

  it('PayrollDeductionSource enum + PayrollCustomDeduction.source', () => {
    const e = Prisma.dmmf.datamodel.enums.find((x) => x.name === 'PayrollDeductionSource');
    expect(e?.values.map((v) => v.name)).toEqual(['MANUAL', 'COMMISSION_CLAWBACK']);
    expect(field('PayrollCustomDeduction', 'source')).toMatchObject({ type: 'PayrollDeductionSource', isRequired: true, hasDefaultValue: true, default: 'MANUAL' });
  });

  it('PayrollCommissionItem model', () => {
    const e = Prisma.dmmf.datamodel.enums.find((x) => x.name === 'PayrollCommissionItemKind');
    expect(e?.values.map((v) => v.name)).toEqual(['PAY', 'CLAWBACK']);
    expect(model('PayrollCommissionItem').dbName).toBe('payroll_commission_items');
    expect(field('PayrollCommissionItem', 'payrollLineId')).toMatchObject({ type: 'String', isRequired: true });
    expect(field('PayrollCommissionItem', 'salesCommissionId')).toMatchObject({ type: 'String', isRequired: true });
    expect(field('PayrollCommissionItem', 'kind')).toMatchObject({ type: 'PayrollCommissionItemKind', isRequired: true });
    expect(field('PayrollCommissionItem', 'accountCode')).toMatchObject({ type: 'String', isRequired: true });
    expect(field('PayrollCommissionItem', 'amount')).toMatchObject({ type: 'Decimal', isRequired: true });
    expect(field('PayrollCommissionItem', 'releasedAt')).toMatchObject({ type: 'DateTime', isRequired: false });
    expect(field('PayrollCommissionItem', 'payrollLine')).toMatchObject({ relationOnDelete: 'Cascade' });
    expect(field('PayrollCommissionItem', 'salesCommission')).toMatchObject({ relationOnDelete: 'Restrict' });
    expect(model('PayrollCommissionItem').fields.find((f) => f.name === 'deletedAt')).toBeUndefined();
    expect(field('PayrollLine', 'commissionItems')).toMatchObject({ type: 'PayrollCommissionItem', isList: true });
    expect(field('SalesCommission', 'payrollItems')).toMatchObject({ type: 'PayrollCommissionItem', isList: true });
  });

  it('REQUIRED_ROLES has the SHOP-only commission role (no FINANCE role)', () => {
    const roles = (AccountRoleService as unknown as { REQUIRED_ROLES: string[] }).REQUIRED_ROLES;
    expect(roles).toContain('shop_payroll_commission');
    expect(roles).not.toContain('payroll_commission');
  });
});
