import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { VoucherJournalTable } from './VoucherJournalTable';

const lines = [
  { accountCode: '53-1101', accountName: 'ค่าใช้จ่าย', debit: '1234.56', credit: '0' },
  { accountCode: '52-1104', accountName: 'ส่วนลดเศษสตางค์', debit: '0', credit: '0.56' },
  { accountCode: '53-1503', accountName: 'ปัดเศษ', debit: '0.01', credit: '0' },
];

it('keeps adjustment rows visible on screen but marks only those rows hidden for print', () => {
  const { rerender } = render(<VoucherJournalTable lines={lines} includeAdjustment={false} />);
  const rows = screen.getAllByRole('row').slice(1);
  expect(rows).toHaveLength(3);
  expect(within(rows[0]).getByText('1,234.56')).toBeVisible();
  expect(within(rows[0]).getByText('—')).toBeVisible();
  expect(rows[0]).not.toHaveClass('print:hidden');
  expect(rows[1]).toHaveClass('print:hidden');
  expect(rows[2]).toHaveClass('print:hidden');
  expect(within(rows[1]).getByText('0.56')).toBeVisible();
  rerender(<VoucherJournalTable lines={lines} includeAdjustment />);
  for (const row of screen.getAllByRole('row')) expect(row).not.toHaveClass('print:hidden');
});

it.each([undefined, []])('omits the journal section when there are no lines (%j)', (empty) => {
  render(<VoucherJournalTable lines={empty} includeAdjustment />);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByText('Auto Journal')).not.toBeInTheDocument();
});
