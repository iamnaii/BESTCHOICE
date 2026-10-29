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
    expect(e?.values.map((v) => v.name)).toEqual(['MANUAL', 'ADJUSTMENT', 'ATTENDANCE_OT', 'ATTENDANCE_HOLIDAY', 'ATTENDANCE_HOLIDAY_OT']);
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
});
