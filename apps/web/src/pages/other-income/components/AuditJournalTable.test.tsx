import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AuditJournalTable } from './AuditJournalTable';

it('renders independent original/modified amounts with two decimals, including zero and negatives', () => {
  render(
    <>
      <AuditJournalTable lines={[{ accountCode: '11-1101', debit: '1234.5', credit: 0 }]} />
      <AuditJournalTable lines={[{ accountCode: '11-1101', debit: 0, credit: '-0.5' }]} />
    </>,
  );
  const [original, modified] = screen.getAllByRole('table');
  expect(within(original).getByText('1,234.50')).toBeInTheDocument();
  expect(within(original).getByText('0.00')).toBeInTheDocument();
  expect(within(modified).getByText('0.00')).toBeInTheDocument();
  expect(within(modified).getByText('-0.50')).toBeInTheDocument();
});

it('handles an audit event without journal lines', () => {
  render(<AuditJournalTable />);
  expect(screen.queryAllByRole('row')).toHaveLength(0);
});
