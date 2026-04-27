import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ContactLogDialog from './ContactLogDialog';
import type { ContractRow } from '../types';

const mutate = vi.fn();

vi.mock('../hooks/useContactLog', () => ({
  useContactLog: () => ({
    mutate,
    isPending: false,
  }),
}));

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: [] }) },
  getErrorMessage: (err: unknown) => String(err),
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
  settlementAmount: null,
  secondSettlementDate: null,
  secondSettlementAmount: null,
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

function renderDialog(props: Partial<React.ComponentProps<typeof ContactLogDialog>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ContactLogDialog open={true} contract={contract} onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

describe('<ContactLogDialog />', () => {
  beforeEach(() => mutate.mockClear());

  it('renders title with customer name', () => {
    renderDialog();
    expect(screen.getByText(/บันทึกผล/)).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByText(/บันทึกผล/)).not.toBeInTheDocument();
  });

  it('hides settlement section when outcome is "ไม่รับสาย"', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /ไม่รับสาย/ }));
    expect(screen.queryByText(/วันที่นัดจ่าย/)).not.toBeInTheDocument();
  });

  it('non-split mode: default amount = outstanding, editable', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /นัดชำระ/ }));

    const amountInput = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(amountInput.value).toBe('5500');
  });

  it('non-split: rejects amount > outstanding (validation message)', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /นัดชำระ/ }));

    const amountInput = screen.getByRole('spinbutton');
    await user.clear(amountInput);
    await user.type(amountInput, '99999');

    expect(screen.getByText(/ยอดต้องมากกว่า 0 และไม่เกิน/)).toBeInTheDocument();
  });

  it('split mode: defaults งวด 1 = floor(outstanding/2) = 2750', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /นัดชำระ/ }));
    await user.click(screen.getByRole('checkbox', { name: /นัดแบ่งจ่าย 2 งวด/ }));

    expect(screen.getByText('งวดที่ 1')).toBeInTheDocument();
    expect(screen.getByText('งวดที่ 2')).toBeInTheDocument();

    const amount1Input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(amount1Input.value).toBe('2750');
  });

  it('split mode: งวด 2 amount auto-calc + readonly (= outstanding − งวด 1)', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /นัดชำระ/ }));
    await user.click(screen.getByRole('checkbox', { name: /นัดแบ่งจ่าย 2 งวด/ }));

    const amount1Input = screen.getByRole('spinbutton');
    await user.clear(amount1Input);
    await user.type(amount1Input, '2000');

    // งวด 2 = 5500 − 2000 = 3500 (formatted)
    const amount2Display = screen.getByLabelText(/ยอดงวดที่ 2/) as HTMLInputElement;
    expect(amount2Display.readOnly).toBe(true);
    expect(amount2Display.value).toMatch(/3,?500/);
  });

  it('split mode: งวด 1 ≥ outstanding rejected (would zero งวด 2)', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /นัดชำระ/ }));
    await user.click(screen.getByRole('checkbox', { name: /นัดแบ่งจ่าย 2 งวด/ }));

    const amount1Input = screen.getByRole('spinbutton');
    await user.clear(amount1Input);
    await user.type(amount1Input, '5500');

    expect(screen.getByText(/งวดที่ 1 ต้องน้อยกว่ายอดค้าง/)).toBeInTheDocument();
  });

  it('split mode: toggle off restores settlementAmount = outstanding', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /นัดชำระ/ }));

    const checkbox = screen.getByRole('checkbox', { name: /นัดแบ่งจ่าย 2 งวด/ });
    await user.click(checkbox); // ON
    await user.click(checkbox); // OFF

    const amountInput = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(amountInput.value).toBe('5500');
  });
});
