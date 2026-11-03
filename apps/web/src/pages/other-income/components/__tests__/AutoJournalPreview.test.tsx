import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AutoJournalPreview } from '../AutoJournalPreview';

vi.mock('@/hooks/useCoa', () => ({ useCoaByCodes: () => ({ data: [] }) }));

// re-review m1 (Task 28, 2026-11-01): the "ยอดสมดุล" badge compared floats with a 0.01 tolerance —
// Math.abs(1.13 - 1.12) = 0.00999… so a real 0.01 gap showed "1.13 = 1.12 ยอดสมดุล". Same rule as
// EditableJournalTable now: sum whole satang, compare exactly (owner decision 2026-10-31 — no tolerance).
describe('AutoJournalPreview — balance badge', () => {
  it('shows a 0.01 gap as unbalanced (1.13 vs 1.12)', () => {
    render(
      <AutoJournalPreview
        lines={[
          { accountCode: '11-1101', debit: 1.13, credit: 0 },
          { accountCode: '42-1102', debit: 0, credit: 1.12 },
        ]}
      />,
    );
    expect(screen.queryByText(/ยอดสมดุล/)).not.toBeInTheDocument();
    expect(screen.getByText(/Dr 1\.13 ≠ Cr 1\.12/)).toBeInTheDocument();
  });

  it('shows equal totals as balanced even when the floats are inexact (0.1 + 0.2 vs 0.3)', () => {
    render(
      <AutoJournalPreview
        lines={[
          { accountCode: '11-1101', debit: 0.1, credit: 0 },
          { accountCode: '11-1102', debit: 0.2, credit: 0 },
          { accountCode: '42-1102', debit: 0, credit: 0.3 },
        ]}
      />,
    );
    expect(screen.getByText(/0\.30 = 0\.30 ยอดสมดุล/)).toBeInTheDocument();
  });
});
