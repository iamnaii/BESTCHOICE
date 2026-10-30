import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DocTypePicker } from '../DocTypePicker';

// คำตัดสินเจ้าของ 2026-10-28 — ผู้จัดการสาขาไม่เห็นชิป "เงินเดือน"
describe('DocTypePicker — payroll chip', () => {
  it('shows เงินเดือน by default and hides it when payroll is not allowed', () => {
    const { rerender } = render(<DocTypePicker value="EXPENSE_SAMEDAY" onChange={() => {}} invoiceDateIsToday />);
    expect(screen.getByText('เงินเดือน')).toBeInTheDocument();
    rerender(<DocTypePicker value="EXPENSE_SAMEDAY" onChange={() => {}} invoiceDateIsToday payrollEnabled={false} />);
    expect(screen.queryByText('เงินเดือน')).not.toBeInTheDocument();
    expect(screen.getByText('จ่ายทันที')).toBeInTheDocument();
  });
});
