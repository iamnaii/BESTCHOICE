import { maskPayrollTaxIds } from './payroll-pii-mask.util';

const payrollDoc = (...taxIds: Array<string | null>) => ({
  payroll: { lines: taxIds.map((employeeTaxId) => ({ employeeTaxId })) },
});

describe('maskPayrollTaxIds', () => {
  it.each(['OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER'])(
    'leaves tax IDs untouched for the PII-cleared role %s',
    (role) => {
      const doc = payrollDoc('1234567890123');
      maskPayrollTaxIds(doc, role);
      expect(doc.payroll.lines[0].employeeTaxId).toBe('1234567890123');
    },
  );

  it.each(['SALES', 'BRANCH_MANAGER', undefined, null])(
    'masks tax IDs (keeping the last 4) for non-cleared role %s',
    (role) => {
      const doc = payrollDoc('1234567890123');
      maskPayrollTaxIds(doc, role);
      expect(doc.payroll.lines[0].employeeTaxId).toBe('•••••••••0123');
    },
  );

  it('masks every line', () => {
    const doc = payrollDoc('1111111111111', '2222222222222');
    maskPayrollTaxIds(doc, 'SALES');
    expect(doc.payroll.lines.map((l) => l.employeeTaxId)).toEqual(['•••••••••1111', '•••••••••2222']);
  });

  it('leaves a null tax ID as null', () => {
    const doc = payrollDoc(null);
    maskPayrollTaxIds(doc, 'SALES');
    expect(doc.payroll.lines[0].employeeTaxId).toBeNull();
  });

  it('is a no-op for a non-payroll doc', () => {
    const doc: { payroll?: null } = { payroll: null };
    expect(() => maskPayrollTaxIds(doc, 'SALES')).not.toThrow();
    const doc2: Record<string, never> = {};
    expect(() => maskPayrollTaxIds(doc2, 'SALES')).not.toThrow();
  });
});
