import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactLogDialog from './ContactLogDialog';
import type { ContractRow } from '../types';

// Mock the hook so it doesn't require a real QueryClient
vi.mock('../hooks/useContactLog', () => ({
  useContactLog: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

const contract: ContractRow = {
  id: 'ctr-1',
  contractNumber: 'BC-2026-0001',
  status: 'OVERDUE',
  dunningStage: 'NOTICE',
  customer: { id: 'cus-1', name: 'สมชาย ใจดี', phone: '0812345678', lineId: null },
  branch: { id: 'br-1', name: 'สาขาลาดพร้าว' },
  assignedTo: null,
  outstanding: 5500,
  daysOverdue: 12,
  lastCallResult: null,
  lastCallAt: null,
  noAnswerCount: 0,
  settlementDate: null,
  needsSkipTracing: false,
  deviceLocked: false,
  lastContactedAt: null,
  brokenPromiseCount: 0,
  mdmState: 'NONE',
  relatedContractsCount: 0,
  lastChannel: null,
};

describe('<ContactLogDialog />', () => {
  it('renders when open', () => {
    render(<ContactLogDialog open={true} contract={contract} onClose={vi.fn()} />);
    expect(screen.getByText('ผลการติดต่อ')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<ContactLogDialog open={false} contract={contract} onClose={vi.fn()} />);
    expect(screen.queryByText('ผลการติดต่อ')).not.toBeInTheDocument();
  });

  it('reveals settlement section when result is PROMISED', async () => {
    const user = userEvent.setup();
    render(<ContactLogDialog open={true} contract={contract} onClose={vi.fn()} />);

    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'PROMISED');

    // Settlement section label appears
    expect(screen.getByText(/วันที่นัดชำระ/)).toBeInTheDocument();
  });

  it('hides settlement section when result is NO_ANSWER', async () => {
    const user = userEvent.setup();
    render(<ContactLogDialog open={true} contract={contract} onClose={vi.fn()} />);

    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'NO_ANSWER');

    expect(screen.queryByText(/วันที่นัดชำระ/)).not.toBeInTheDocument();
  });
});
