import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import IntercompanySettlementPage from '../IntercompanySettlementPage';
import { useAuth } from '@/contexts/AuthContext';

// --- mock sonner ---------------------------------------------------------
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
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
  getErrorMessage: (err: unknown) =>
    err && typeof err === 'object' && 'message' in err ? String((err as Error).message) : 'unknown',
}));

// --- mock useAuth ----------------------------------------------------------
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'u1', role: 'OWNER', branchId: null },
    isLoading: false,
    isAuthenticated: true,
  })),
}));

function asRole(role: string, id = 'u9') {
  (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    user: { id, role, branchId: null },
    isLoading: false,
    isAuthenticated: true,
  });
}

const pendingResponse = {
  pending: [
    {
      contractId: 'c1',
      contractNumber: 'CT-0001',
      customerName: 'ลูกค้า A',
      activatedAt: '2026-07-01T00:00:00.000Z',
      financedGl: '10000.00',
      commissionGl: '1000.00',
      shopFinancedGl: '10000.00',
      shopCommissionGl: '1000.00',
      legacyNoShop: false,
    },
    {
      contractId: 'c2',
      contractNumber: 'CT-0002',
      customerName: 'ลูกค้า B',
      activatedAt: '2026-06-01T00:00:00.000Z',
      financedGl: '5000.00',
      commissionGl: '500.00',
      shopFinancedGl: '0.00',
      shopCommissionGl: '0.00',
      legacyNoShop: true,
    },
  ],
  reconcile: {
    pendingTotal: '16500.00',
    glFinanceTotal: '16500.00',
    glShopTotal: '11000.00',
    drift: '0.00',
  },
};

const batchesResponse = {
  data: [
    {
      id: 'b1',
      batchNumber: 'IC-20260801-0001',
      status: 'PENDING_APPROVAL',
      transferDate: '2026-08-01T00:00:00.000Z',
      postedAt: null,
      totalFinanced: '10000.00',
      totalCommission: '1000.00',
      totalAmount: '11000.00',
      shopPostedAmount: '11000.00',
      transferRef: null,
      note: null,
      maker: { id: 'u1', name: 'พนักงานบัญชี' },
      approver: null,
      _count: { items: 1 },
    },
  ],
  total: 1,
  page: 1,
  limit: 50,
};

const batchDetailResponse = {
  id: 'b1',
  batchNumber: 'IC-20260801-0001',
  status: 'PENDING_APPROVAL',
  transferDate: '2026-08-01T00:00:00.000Z',
  postedAt: null,
  financeBankCode: '11-1201',
  shopBankCode: 'S11-1201',
  totalFinanced: '10000.00',
  totalCommission: '1000.00',
  totalAmount: '11000.00',
  shopPostedAmount: '11000.00',
  transferRef: null,
  slipFileKey: null,
  note: null,
  makerId: 'u1',
  approverId: null,
  financeJournalEntryId: null,
  shopJournalEntryId: null,
  reverseReason: null,
  financeEntryNumber: null,
  shopEntryNumber: null,
  maker: { id: 'u1', name: 'พนักงานบัญชี' },
  approver: null,
  items: [
    {
      id: 'i1',
      contractId: 'c1',
      financedGl: '10000.00',
      commissionGl: '1000.00',
      shopFinancedGl: '10000.00',
      shopCommissionGl: '1000.00',
      legacyNoShop: false,
      contract: { id: 'c1', contractNumber: 'CT-0001', customer: { name: 'ลูกค้า A' } },
    },
  ],
};

function setupApiGet() {
  apiGet.mockImplementation((url: string) => {
    if (url === '/interco-settlement/pending') {
      return Promise.resolve({ data: pendingResponse });
    }
    if (url === '/interco-settlement/batches') {
      return Promise.resolve({ data: batchesResponse });
    }
    if (url.startsWith('/interco-settlement/batches/')) {
      return Promise.resolve({ data: batchDetailResponse });
    }
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  setupApiGet();
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('IntercompanySettlementPage', () => {
  it('renders the 2 tabs (รอจ่าย / รอบจ่าย) and flags a legacy pending contract', async () => {
    asRole('OWNER');
    wrap(<IntercompanySettlementPage />);

    expect(screen.getByRole('tab', { name: 'รอจ่าย' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'รอบจ่าย' })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('CT-0002')).toBeInTheDocument());
    expect(screen.getByText('CT-0001')).toBeInTheDocument();
    expect(screen.getByText(/LEGACY/)).toBeInTheDocument();
  });

  it('hides the approve button from ACCOUNTANT viewing a PENDING_APPROVAL batch', async () => {
    asRole('ACCOUNTANT', 'u9');
    const user = userEvent.setup();
    wrap(<IntercompanySettlementPage />);

    await user.click(screen.getByRole('tab', { name: 'รอบจ่าย' }));
    await waitFor(() => expect(screen.getByText('IC-20260801-0001')).toBeInTheDocument());

    await user.click(screen.getByText('IC-20260801-0001'));
    await waitFor(() => expect(screen.getByText(/รายการสัญญา/)).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: 'อนุมัติ' })).not.toBeInTheDocument();
    // ACCOUNTANT is a maker-side role — cancel stays available even though
    // this batch's maker is a different user id ('u1' vs 'u9').
    expect(screen.getByRole('button', { name: 'ยกเลิกรอบ' })).toBeInTheDocument();
  });

  it('blocks batch creation when transferDate is cleared', async () => {
    asRole('ACCOUNTANT', 'u1');
    const user = userEvent.setup();
    wrap(<IntercompanySettlementPage />);

    await waitFor(() => expect(screen.getByText('CT-0001')).toBeInTheDocument());
    await user.click(screen.getByRole('checkbox', { name: 'เลือกสัญญา CT-0001' }));
    await user.click(screen.getByRole('button', { name: 'สร้างรอบจ่าย' }));

    const dialog = await screen.findByRole('dialog');
    const dateInput = within(dialog).getByLabelText(/วันที่โอน/);
    await user.clear(dateInput);
    await user.click(within(dialog).getByRole('button', { name: 'สร้างรอบจ่าย' }));

    expect(await within(dialog).findByText('กรุณาระบุวันที่โอน')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalledWith(
      '/interco-settlement/batches',
      expect.anything(),
    );
  });
});
