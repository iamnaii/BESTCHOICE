import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';

// --- mock sonner ---------------------------------------------------------
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// --- mock api -------------------------------------------------------------
const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

import ContractCancellationPage from '../ContractCancellationPage';

/**
 * Phase 3 Task 7 — คิวอนุมัติยกเลิกโชว์ C-1/C-2 ต่อแถว:
 * `settledInBatch` + `recallAmount` (net forecast) จาก listPendingCancellations.
 */
const pendingRows = [
  {
    // C-1 — ยังไม่ตัดจ่ายรอบจ่าย INTER-CO
    id: 'cx-1',
    createdAt: '2026-08-18T00:00:00.000Z',
    reason: 'ลูกค้าขอยกเลิก',
    refundAmount: '0.00',
    status: 'PENDING',
    settledInBatch: false,
    recallAmount: null,
    contract: {
      id: 'c1',
      contractNumber: 'BC-2026-100',
      status: 'ACTIVE',
      customer: { id: 'cu1', name: 'ลูกค้า หนึ่ง', phone: '0811111111' },
    },
    requestedBy: { id: 'u1', name: 'พนักงานขาย หนึ่ง' },
  },
  {
    // C-2 — ตัดจ่ายผ่านรอบ POSTED แล้ว → approve จะตั้งลูกหนี้เรียกคืน
    id: 'cx-2',
    createdAt: '2026-08-19T00:00:00.000Z',
    reason: 'สินค้ามีปัญหา',
    refundAmount: '0.00',
    status: 'PENDING',
    settledInBatch: true,
    recallAmount: '9000.00',
    contract: {
      id: 'c2',
      contractNumber: 'BC-2026-200',
      status: 'ACTIVE',
      customer: { id: 'cu2', name: 'ลูกค้า สอง', phone: '0822222222' },
    },
    requestedBy: { id: 'u2', name: 'พนักงานขาย สอง' },
  },
];

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiGet.mockImplementation((url: string) => {
    if (url === '/contracts/cancellations/pending') {
      return Promise.resolve({ data: pendingRows });
    }
    return Promise.resolve({ data: {} });
  });
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContractCancellationPage', () => {
  it('renders the C-1/C-2 badge per row (settledInBatch + recallAmount)', async () => {
    wrap(<ContractCancellationPage />);

    await waitFor(() => expect(screen.getByText('BC-2026-100')).toBeInTheDocument());

    // C-1 row — straight full reversal
    expect(screen.getByText('ยังไม่ตัดจ่าย — กลับรายการทั้งชุด')).toBeInTheDocument();
    // C-2 row — will book a recall receivable for the net paid-out amount
    expect(screen.getByText('ตัดจ่ายแล้ว — จะตั้งเรียกคืน ฿9,000.00')).toBeInTheDocument();
  });

  it('approve on a C-2 row: confirm dialog explains the recall booking, then POSTs approve', async () => {
    const user = userEvent.setup();
    wrap(<ContractCancellationPage />);

    await waitFor(() => expect(screen.getByText('BC-2026-200')).toBeInTheDocument());

    // rows are ordered [C-1, C-2] — approve the second row
    await user.click(screen.getAllByRole('button', { name: 'อนุมัติ' })[1]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/ตั้งลูกหนี้เรียกคืน/)).toBeInTheDocument();
    expect(within(dialog).getByText(/9,000\.00/)).toBeInTheDocument();

    apiPost.mockResolvedValueOnce({ data: { status: 'APPROVED' } });
    await user.click(within(dialog).getByRole('button', { name: 'อนุมัติ' }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/contracts/cancellations/cx-2/approve'),
    );
  });

  it('approve on a C-1 row: confirm dialog states the full-chain reversal (no recall wording)', async () => {
    const user = userEvent.setup();
    wrap(<ContractCancellationPage />);

    await waitFor(() => expect(screen.getByText('BC-2026-100')).toBeInTheDocument());

    await user.click(screen.getAllByRole('button', { name: 'อนุมัติ' })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/กลับรายการบัญชีทั้งชุด/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/ตั้งลูกหนี้เรียกคืน/)).not.toBeInTheDocument();
  });

  it('marks the legacy refund column as deprecated without removing it', async () => {
    wrap(<ContractCancellationPage />);

    await waitFor(() => expect(screen.getByText('BC-2026-100')).toBeInTheDocument());
    expect(screen.getByText(/เลิกใช้/)).toBeInTheDocument();
  });
});
