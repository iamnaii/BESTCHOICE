import { isExpenseDocumentPaid, isLiveDocument } from '../recurring-bill-paid.util';

const base = { deletedAt: null as Date | null, status: 'POSTED', paidAt: new Date('2026-10-24T05:00:00Z') as Date | null };

describe('isExpenseDocumentPaid (spec §15.2 — POSTED + paidAt only)', () => {
  it('POSTED with paidAt → paid', () => expect(isExpenseDocumentPaid(base)).toBe(true));
  it('VOIDED keeps paidAt but is not paid', () => expect(isExpenseDocumentPaid({ ...base, status: 'VOIDED' })).toBe(false));
  it('soft-deleted is not paid', () => expect(isExpenseDocumentPaid({ ...base, deletedAt: new Date() })).toBe(false));
  it('ACCRUAL (paidAt null) is not paid', () => expect(isExpenseDocumentPaid({ ...base, status: 'ACCRUAL', paidAt: null })).toBe(false));
  it('PENDING_APPROVAL is not paid', () => expect(isExpenseDocumentPaid({ ...base, status: 'PENDING_APPROVAL', paidAt: null })).toBe(false));
  it('null/undefined is not paid', () => {
    expect(isExpenseDocumentPaid(null)).toBe(false);
    expect(isExpenseDocumentPaid(undefined)).toBe(false);
  });
});

describe('isLiveDocument', () => {
  it.each(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACCRUAL', 'POSTED'])('%s is live', (status) => {
    expect(isLiveDocument({ ...base, status })).toBe(true);
  });
  it('VOIDED / deleted / missing are not live', () => {
    expect(isLiveDocument({ ...base, status: 'VOIDED' })).toBe(false);
    expect(isLiveDocument({ ...base, deletedAt: new Date() })).toBe(false);
    expect(isLiveDocument(null)).toBe(false);
  });
});
