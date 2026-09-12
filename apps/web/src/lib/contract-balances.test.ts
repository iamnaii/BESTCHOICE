import { describe, expect, it } from 'vitest';
import { contractBalances } from './contract-balances';

describe('contract remaining vs overdue amounts', () => {
  const now = new Date('2026-09-10T17:00:00Z'); // Sep11 Bangkok midnight
  const payments = [
    { status: 'PARTIALLY_PAID', amountDue: '1000', lateFee: '50', amountPaid: '400', dueDate: '2026-09-09T17:00:00Z' },
    { status: 'PARTIALLY_PAID', amountDue: '1000', lateFee: '50', amountPaid: '1000', dueDate: '2026-09-09T17:00:00Z' },
    { status: 'PENDING', amountDue: '1000', amountPaid: '0', dueDate: '2026-09-10T17:00:00Z' },
    { status: 'PENDING', amountDue: '1000', amountPaid: '0', dueDate: '2026-09-11T17:00:00Z' },
    { status: 'PAID', amountDue: '1000', lateFee: '50', amountPaid: '1050', dueDate: '2026-09-09T17:00:00Z' },
  ];
  it('includes past-due partial and fee-only balances, excludes today/future/paid from overdue', () => {
    expect(contractBalances('ACTIVE', payments, now)).toEqual({ outstanding: 2700, overdue: 700 });
  });
  it('never presents a draft as overdue', () => {
    expect(contractBalances('DRAFT', payments, now)).toEqual({ outstanding: 2700, overdue: 0 });
  });
  it('adds fractional currency without float residue and clamps overpayment per installment', () => {
    const rows = ['0.1', '0.2'].map(amountDue => ({ status: 'PENDING', amountDue, dueDate: '2026-01-01' }));
    rows.push({ status: 'PENDING', amountDue: '0', dueDate: '2026-01-01' });
    expect(contractBalances('ACTIVE', rows, now).outstanding).toBe(0.3);
  });
});
