import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ContactLogDialog from './ContactLogDialog';
import type { ContractRow } from '../types';

// Mock the hook so it doesn't require a real QueryClient
vi.mock('../hooks/useContactLog', () => ({
  useContactLog: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

// Mock api calls made by useQuery inside the dialog
vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

const contract: ContractRow = {
  id: 'ctr-1',
  contractNumber: 'BC-2026-0001',
  status: 'OVERDUE',
  dunningStage: 'NOTICE',
  customer: { id: 'cus-1', name: 'สมชาย ใจดี', phone: '0812345678', lineIdFinance: null, lineIdShop: null },
  branch: { id: 'br-1', name: 'สาขาลาดพร้าว' },
  assignedTo: null,
  outstanding: 5500,
  daysOverdue: 12,
  lastCallResult: null,
  lastCallAt: null,
  noAnswerCount: 0,
  settlementDate: null,
  settlementAmount: null,
  needsSkipTracing: false,
  deviceLocked: false,
  lastContactedAt: null,
  brokenPromiseCount: 0,
  mdmState: 'NONE',
  relatedContractsCount: 0,
  lastChannel: null,
  letterCount: 0,
  slipReviewPending: false,
};

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('<ContactLogDialog />', () => {
  it('renders modal title with customer name when open', () => {
    renderWithQueryClient(
      <ContactLogDialog open={true} contract={contract} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/บันทึกผล/)).toBeInTheDocument();
    expect(screen.getByText(/สมชาย ใจดี/)).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    renderWithQueryClient(
      <ContactLogDialog open={false} contract={contract} onClose={vi.fn()} />,
    );
    expect(screen.queryByText(/บันทึกผล/)).not.toBeInTheDocument();
  });

  it('shows outcome chips for 3 choices', () => {
    renderWithQueryClient(
      <ContactLogDialog open={true} contract={contract} onClose={vi.fn()} />,
    );
    expect(screen.getByText('นัดชำระ')).toBeInTheDocument();
    expect(screen.getByText('ไม่รับสาย')).toBeInTheDocument();
    expect(screen.getByText('ติดต่อไม่ได้')).toBeInTheDocument();
  });

  it('reveals settlement section (N-slot manager) when "นัดชำระ" is clicked', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(
      <ContactLogDialog open={true} contract={contract} onClose={vi.fn()} />,
    );

    await user.click(screen.getByText('นัดชำระ'));

    // Settlement card should appear with slot label
    expect(screen.getByText('ที่ 1')).toBeInTheDocument();
    // Sum indicator
    expect(screen.getByText(/รวม/)).toBeInTheDocument();
    // Add-slot button
    expect(screen.getByRole('button', { name: /เพิ่ม/i })).toBeInTheDocument();
  });

  it('hides settlement section when "ไม่รับสาย" is clicked', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(
      <ContactLogDialog open={true} contract={contract} onClose={vi.fn()} />,
    );

    await user.click(screen.getByText('ไม่รับสาย'));

    // Settlement section should NOT appear
    expect(screen.queryByText('ที่ 1')).not.toBeInTheDocument();
  });

  it('allows adding a second slot', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(
      <ContactLogDialog open={true} contract={contract} onClose={vi.fn()} />,
    );

    await user.click(screen.getByText('นัดชำระ'));
    // Find and click the "เพิ่ม" button (add slot)
    const addButton = screen.getByRole('button', { name: /เพิ่ม/i });
    await user.click(addButton);

    // Now there should be two slots
    expect(screen.getByText('ที่ 1')).toBeInTheDocument();
    expect(screen.getByText('ที่ 2')).toBeInTheDocument();
    // Sum indicator shows 2 slots
    expect(screen.getByText(/รวม 2 ที่/)).toBeInTheDocument();
  });

  it('shows LINE notify hint after any outcome is selected', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(
      <ContactLogDialog open={true} contract={contract} onClose={vi.fn()} />,
    );

    await user.click(screen.getByText('ไม่รับสาย'));

    expect(
      screen.getByText(/ระบบจะส่ง LINE แจ้งเตือนลูกค้าทันทีหลังบันทึก/),
    ).toBeInTheDocument();
  });

  it('displays contract number and outstanding in summary', () => {
    renderWithQueryClient(
      <ContactLogDialog open={true} contract={contract} onClose={vi.fn()} />,
    );

    expect(screen.getByText('BC-2026-0001')).toBeInTheDocument();
    // Outstanding 5500 formatted
    expect(screen.getByText('12 วัน')).toBeInTheDocument();
  });
});
