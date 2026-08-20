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
      // สัญญาเปลี่ยนเครื่อง Phase 2 — หักกลบได้
      swapCreditGl: '2000.00',
      shopBuybackPayableGl: '2000.00',
      swapCreditEligible: true,
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
      swapCreditGl: '0.00',
      shopBuybackPayableGl: '0.00',
      swapCreditEligible: false,
    },
  ],
  recalls: [
    {
      contractId: 'r1',
      contractNumber: 'CT-0009',
      customerName: 'ลูกค้า C',
      recallGl: '500.00',
      shopRecallGl: '500.00',
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
      totalDeduction: '500.00',
      netTransferAmount: '10500.00',
      shopNetAmount: '10500.00',
      transferRef: null,
      note: null,
      maker: { id: 'u1', name: 'พนักงานบัญชี' },
      approver: null,
      _count: { items: 2 },
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
  totalDeduction: '500.00',
  netTransferAmount: '10500.00',
  shopNetAmount: '10500.00',
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
      itemType: 'SETTLEMENT',
      financedGl: '10000.00',
      commissionGl: '1000.00',
      shopFinancedGl: '10000.00',
      shopCommissionGl: '1000.00',
      legacyNoShop: false,
      swapCreditAmount: '0.00',
      recallAmount: '0.00',
      contract: { id: 'c1', contractNumber: 'CT-0001', customer: { name: 'ลูกค้า A' } },
    },
    {
      id: 'i2',
      contractId: 'r1',
      itemType: 'RECALL',
      financedGl: '0.00',
      commissionGl: '0.00',
      shopFinancedGl: '0.00',
      shopCommissionGl: '0.00',
      legacyNoShop: false,
      swapCreditAmount: '0.00',
      recallAmount: '500.00',
      contract: { id: 'r1', contractNumber: 'CT-0009', customer: { name: 'ลูกค้า C' } },
    },
  ],
};

function setupApiGet(pending: unknown = pendingResponse) {
  apiGet.mockImplementation((url: string) => {
    if (url === '/interco-settlement/pending') {
      return Promise.resolve({ data: pending });
    }
    if (url === '/interco-settlement/batches') {
      return Promise.resolve({ data: batchesResponse });
    }
    if (url.startsWith('/interco-settlement/batches/')) {
      return Promise.resolve({ data: batchDetailResponse });
    }
    if (url.startsWith('/chart-of-accounts/by-codes')) {
      return Promise.resolve({
        data: [
          { code: '11-1201', name: 'ธนาคาร KBank' },
          { code: 'S11-1201', name: 'ธนาคาร KBank หน้าร้าน' },
        ],
      });
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
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
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
    expect(apiPost).not.toHaveBeenCalledWith('/interco-settlement/batches', expect.anything());
  });

  it('shows the recall section, net summary, and sends recallContractIds on create (Phase 2)', async () => {
    asRole('ACCOUNTANT', 'u1');
    const user = userEvent.setup();
    wrap(<IntercompanySettlementPage />);

    await waitFor(() => expect(screen.getByText('CT-0001')).toBeInTheDocument());

    // Swap-credit deduction column on the eligible pending row (11-2107 lens).
    expect(screen.getByText('−2,000.00')).toBeInTheDocument();

    // Recall section (Flow C-2) renders with its own checkbox.
    expect(screen.getByText(/รายการเรียกคืน \(ยกเลิกหลังตัดจ่าย\)/)).toBeInTheDocument();
    expect(screen.getByText('CT-0009')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'เลือกสัญญา CT-0001' }));
    await user.click(screen.getByRole('checkbox', { name: 'เลือกเรียกคืนสัญญา CT-0009' }));
    await user.click(screen.getByRole('button', { name: 'สร้างรอบจ่าย' }));

    const dialog = await screen.findByRole('dialog');
    // 3-line summary: 11,000 gross − (2,000 swap credit + 500 recall) = 8,500 net.
    expect(within(dialog).getByText('ยอดโอนสุทธิ')).toBeInTheDocument();
    expect(within(dialog).getByText('฿8,500.00')).toBeInTheDocument();
    expect(within(dialog).getByText('−฿2,500.00')).toBeInTheDocument();

    apiPost.mockResolvedValueOnce({
      data: { id: 'b9', batchNumber: 'IC-20260820-0001' },
    });
    await user.click(within(dialog).getByRole('button', { name: 'สร้างรอบจ่าย' }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/interco-settlement/batches',
        expect.objectContaining({
          contractIds: ['c1'],
          recallContractIds: ['r1'],
        }),
      ),
    );
  });

  it('shows netAmountOf (ยอดโอนสุทธิ) — not gross totalAmount — in the batches list', async () => {
    asRole('OWNER');
    const user = userEvent.setup();
    wrap(<IntercompanySettlementPage />);

    await user.click(screen.getByRole('tab', { name: 'รอบจ่าย' }));
    await waitFor(() => expect(screen.getByText('IC-20260801-0001')).toBeInTheDocument());

    // Header relabeled + row shows net 10,500.00 (fixture: gross 11,000 − หัก 500).
    expect(screen.getByText('ยอดโอนสุทธิ')).toBeInTheDocument();
    expect(screen.getByText('10,500.00')).toBeInTheDocument();
    expect(screen.queryByText('11,000.00')).not.toBeInTheDocument();
  });

  it('falls back to totalAmount in the batches list for a pre-Phase 2 batch (netTransferAmount = null)', async () => {
    asRole('OWNER');
    apiGet.mockImplementation((url: string) => {
      if (url === '/interco-settlement/pending') return Promise.resolve({ data: pendingResponse });
      if (url === '/interco-settlement/batches') {
        return Promise.resolve({
          data: {
            ...batchesResponse,
            data: [
              {
                ...batchesResponse.data[0],
                totalDeduction: '0.00',
                netTransferAmount: null,
                shopNetAmount: null,
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    wrap(<IntercompanySettlementPage />);

    await user.click(screen.getByRole('tab', { name: 'รอบจ่าย' }));
    await waitFor(() => expect(screen.getByText('IC-20260801-0001')).toBeInTheDocument());

    // netAmountOf(null) = totalAmount เต็ม — รอบเก่าแสดงค่าเดิมโดยอัตโนมัติ
    expect(screen.getByText('11,000.00')).toBeInTheDocument();
  });

  it('renders Phase 2 batch detail with deduction line, net amount, and RECALL badge', async () => {
    asRole('OWNER');
    const user = userEvent.setup();
    wrap(<IntercompanySettlementPage />);

    await user.click(screen.getByRole('tab', { name: 'รอบจ่าย' }));
    await waitFor(() => expect(screen.getByText('IC-20260801-0001')).toBeInTheDocument());
    await user.click(screen.getByText('IC-20260801-0001'));
    await waitFor(() => expect(screen.getByText(/รายการสัญญา/)).toBeInTheDocument());

    // ปรากฏ 2 ที่: header ตารางรอบจ่าย (IMPORTANT 2) + InfoField ในชีทรายละเอียด
    expect(screen.getAllByText('ยอดโอนสุทธิ').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('−฿500.00')).toBeInTheDocument(); // หักรวม (InfoField)
    expect(screen.getByText('−500.00')).toBeInTheDocument(); // ยอดหักของแถว RECALL ในตาราง items
    expect(screen.getByText('เรียกคืน')).toBeInTheDocument(); // badge บนแถว RECALL
    expect(screen.getByText('CT-0009')).toBeInTheDocument();
  });

  it('hides the deduction line for a pre-Phase 2 batch (netTransferAmount = null)', async () => {
    asRole('OWNER');
    apiGet.mockImplementation((url: string) => {
      if (url === '/interco-settlement/pending') return Promise.resolve({ data: pendingResponse });
      if (url === '/interco-settlement/batches') return Promise.resolve({ data: batchesResponse });
      if (url.startsWith('/interco-settlement/batches/')) {
        return Promise.resolve({
          data: {
            ...batchDetailResponse,
            totalDeduction: '0.00',
            netTransferAmount: null,
            shopNetAmount: null,
            items: [batchDetailResponse.items[0]],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    wrap(<IntercompanySettlementPage />);

    await user.click(screen.getByRole('tab', { name: 'รอบจ่าย' }));
    await waitFor(() => expect(screen.getByText('IC-20260801-0001')).toBeInTheDocument());
    await user.click(screen.getByText('IC-20260801-0001'));
    await waitFor(() => expect(screen.getByText(/รายการสัญญา/)).toBeInTheDocument());

    // netAmountOf(null) = totalAmount เต็ม — ไม่มีบรรทัดหัก
    expect(screen.queryByText(/หักรวม/)).not.toBeInTheDocument();
    expect(screen.getAllByText('ยอดโอนสุทธิ').length).toBeGreaterThanOrEqual(2);
    // ฿11,000.00 ปรากฏทั้งยอดเจ้าหนี้รวม + ยอดโอนสุทธิ (+ ยอด SHOP รับจริง fallback)
    expect(screen.getAllByText('฿11,000.00').length).toBeGreaterThanOrEqual(2);
  });

  // ── Phase 3 Task 7: ปุ่มรับเงินสดคืน (settle-cash) บน recall section ──────────

  it('opens the recall cash dialog and POSTs settle-cash with defaults + a UUID requestId (Phase 3)', async () => {
    asRole('OWNER');
    const user = userEvent.setup();
    wrap(<IntercompanySettlementPage />);

    await waitFor(() => expect(screen.getByText('CT-0009')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'รับเงินสดคืน' }));
    const dialog = await screen.findByRole('dialog');

    // ยอด default = net recallGl ของแถว
    expect(within(dialog).getByLabelText(/ยอดรับเงินคืน/)).toHaveValue(500);

    apiPost.mockResolvedValueOnce({
      data: { financeEntryNo: 'JE-202608-00001', shopEntryNo: 'SJE-202608-00001', deduped: false },
    });
    await user.click(within(dialog).getByRole('button', { name: 'บันทึกรับเงินคืน' }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/interco-settlement/recalls/r1/settle-cash',
        expect.objectContaining({
          amount: 500,
          financeDepositAccountCode: '11-1201',
          shopPayoutAccountCode: 'S11-1201',
          requestId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          ),
        }),
      ),
    );
  });

  it('blocks settle-cash when the amount exceeds the outstanding net recall', async () => {
    asRole('FINANCE_MANAGER');
    const user = userEvent.setup();
    wrap(<IntercompanySettlementPage />);

    await waitFor(() => expect(screen.getByText('CT-0009')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'รับเงินสดคืน' }));
    const dialog = await screen.findByRole('dialog');

    const amountInput = within(dialog).getByLabelText(/ยอดรับเงินคืน/);
    await user.clear(amountInput);
    await user.type(amountInput, '600');

    expect(within(dialog).getByText(/เกินยอดเรียกคืนคงเหลือ/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'บันทึกรับเงินคืน' })).toBeDisabled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('hides รับเงินสดคืน from maker-side roles (endpoint is OWNER/FM only)', async () => {
    asRole('ACCOUNTANT', 'u1');
    wrap(<IntercompanySettlementPage />);

    await waitFor(() => expect(screen.getByText('CT-0009')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'รับเงินสดคืน' })).not.toBeInTheDocument();
  });

  it('disables รับเงินสดคืน on a recall row whose two books mismatch', async () => {
    asRole('OWNER');
    setupApiGet({
      ...pendingResponse,
      recalls: [{ ...pendingResponse.recalls[0], shopRecallGl: '400.00' }],
    });
    wrap(<IntercompanySettlementPage />);

    await waitFor(() => expect(screen.getByText('CT-0009')).toBeInTheDocument());
    expect(screen.getByText('ยอดสองสมุดไม่ตรง')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'รับเงินสดคืน' })).toBeDisabled();
  });
});
