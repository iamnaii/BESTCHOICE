import { resolvePayrollMatch } from './backfill-payroll-user-fk.cli';

const users = [
  { id: 'u1', name: 'สมชาย ใจดี', nationalId: '1234567890123' },
  { id: 'u2', name: 'สมหญิง แซ่ลี้', nationalId: '9999999999999' },
  { id: 'u3', name: 'สมหญิง แซ่ลี้', nationalId: '8888888888888' }, // duplicate NAME, different id
];

describe('resolvePayrollMatch', () => {
  it('tier-1: exact taxId === nationalId, unique → confident link', () => {
    expect(resolvePayrollMatch({ employeeName: 'อะไรก็ได้', employeeTaxId: '1234567890123' }, users))
      .toEqual({ kind: 'tier1', userId: 'u1' });
  });

  it('tier-2: no taxId match, exact unique name → name match (manual review)', () => {
    expect(resolvePayrollMatch({ employeeName: 'สมชาย ใจดี', employeeTaxId: null }, users))
      .toEqual({ kind: 'tier2', userId: 'u1' });
  });

  it('tier-2-ambiguous: exact name matches MORE THAN ONE user → never auto-link', () => {
    expect(resolvePayrollMatch({ employeeName: 'สมหญิง แซ่ลี้', employeeTaxId: null }, users))
      .toEqual({ kind: 'tier2-ambiguous', candidateIds: ['u2', 'u3'] });
  });

  it('name match is case/space-insensitive', () => {
    expect(resolvePayrollMatch({ employeeName: '  สมชาย ใจดี  ', employeeTaxId: null }, users))
      .toEqual({ kind: 'tier2', userId: 'u1' });
  });

  it('taxId takes precedence over name', () => {
    expect(resolvePayrollMatch({ employeeName: 'สมหญิง แซ่ลี้', employeeTaxId: '1234567890123' }, users))
      .toEqual({ kind: 'tier1', userId: 'u1' });
  });

  it('unmatched: no taxId match and no name match → leave null', () => {
    expect(resolvePayrollMatch({ employeeName: 'คนแปลกหน้า', employeeTaxId: '0000000000000' }, users))
      .toEqual({ kind: 'unmatched' });
  });

  it('ambiguous taxId (should not happen — nationalId unique) falls through, not auto-linked', () => {
    const dup = [{ id: 'a', name: 'X', nationalId: '5' }, { id: 'b', name: 'Y', nationalId: '5' }];
    expect(resolvePayrollMatch({ employeeName: 'Z', employeeTaxId: '5' }, dup))
      .toEqual({ kind: 'unmatched' });
  });
});
