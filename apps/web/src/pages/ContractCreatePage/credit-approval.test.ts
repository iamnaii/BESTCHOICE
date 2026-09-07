import { expect, it } from 'vitest';
import { contractCreditIssue } from './credit-approval';

const approval = { id: 'approval', approvedMonthlyPayment: '1500', salaryPayDay: 25,
  usedByContractId: null, supersededAt: null };
const plan = { monthlyPayment: 1500, financedAmount: 9000, totalMonths: 6, paymentDueDay: 25 };
it('requires an unused approval even when the old status says APPROVED', () => {
  expect(contractCreditIssue(null, plan)).toMatch(/อนุมัติ/);
  expect(contractCreditIssue({ ...approval, usedByContractId: 'old' }, plan)).toMatch(/ใช้/);
});
it('checks the final installment as well as the displayed monthly amount', () => {
  expect(contractCreditIssue(approval, { ...plan, financedAmount: 9000.01 })).toMatch(/เกิน/);
  expect(contractCreditIssue(approval, plan)).toBeNull();
});
it('requires the confirmed payday, including end of month', () => {
  expect(contractCreditIssue(approval, { ...plan, paymentDueDay: 30 })).toMatch(/วัน/);
  expect(contractCreditIssue({ ...approval, salaryPayDay: 31 }, { ...plan, paymentDueDay: 31 })).toBeNull();
});
