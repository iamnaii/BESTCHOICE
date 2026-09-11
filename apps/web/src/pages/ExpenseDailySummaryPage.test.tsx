import { describe, it, expect } from 'vitest';
import { documentCategories, TYPE_LABELS } from './ExpenseDailySummaryPage';

/**
 * DOC-03 (#1562) — the printed daily summary dropped every account code (the
 * API returns `expenseDetail.lines`, the page read `expenseDetail.category`)
 * and printed the raw enum for document types without a Thai label.
 */
describe('ExpenseDailySummaryPage — row helpers', () => {
  it('lists the distinct account codes of a multi-line document in line order', () => {
    expect(documentCategories({
      expenseDetail: { lines: [{ category: '53-1201' }, { category: '53-1105' }, { category: '53-1201' }] },
      creditNote: null,
    })).toBe('53-1201, 53-1105');
  });

  it('falls back to "-" for documents without expense lines (vendor settlement)', () => {
    expect(documentCategories({ expenseDetail: null, creditNote: null })).toBe('-');
    expect(documentCategories({ expenseDetail: { lines: [] }, creditNote: null })).toBe('-');
  });

  it('keeps a credit-note category alongside its lines', () => {
    expect(documentCategories({ expenseDetail: { lines: [{ category: '53-1201' }] }, creditNote: { category: '53-1202' } })).toBe('53-1201, 53-1202');
  });

  it('has a Thai label for every document type the summary can contain', () => {
    for (const type of ['EXPENSE', 'CREDIT_NOTE', 'PAYROLL', 'VENDOR_SETTLEMENT', 'PETTY_CASH_REIMBURSEMENT', 'REPAIR_SERVICE'] as const) {
      expect(TYPE_LABELS[type]).toMatch(/[ก-๙]/);
      expect(TYPE_LABELS[type]).not.toContain('_');
    }
    expect(TYPE_LABELS.PETTY_CASH_REIMBURSEMENT).toContain('เงินสดย่อย');
  });
});
