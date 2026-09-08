import { describe, it, expect } from 'vitest';
import { mapExpenseStatusToIcab } from '@/pages/ExpenseDetailPage';

/**
 * The bar speaks the 4-state ICAB model; expense docs carry 6 states. This
 * mapping is the contract that keeps the action bar's buttons aligned with the
 * expense lifecycle (owner decision: ACCRUAL maps to POSTED).
 */
describe('mapExpenseStatusToIcab', () => {
  it('DRAFT stays DRAFT', () => {
    expect(mapExpenseStatusToIcab('DRAFT')).toBe('DRAFT');
  });

  it('PENDING_APPROVAL maps to READY (awaiting approval)', () => {
    expect(mapExpenseStatusToIcab('PENDING_APPROVAL')).toBe('READY');
  });

  it('APPROVED exposes the posting action because no journal has been booked yet', () => {
    expect(mapExpenseStatusToIcab('APPROVED')).toBe('DRAFT');
  });

  it('ACCRUAL / POSTED map to POSTED (booked → close/print/reverse)', () => {
    expect(mapExpenseStatusToIcab('ACCRUAL')).toBe('POSTED');
    expect(mapExpenseStatusToIcab('POSTED')).toBe('POSTED');
  });

  it('VOIDED maps to REVERSED (terminal)', () => {
    expect(mapExpenseStatusToIcab('VOIDED')).toBe('REVERSED');
  });
});
