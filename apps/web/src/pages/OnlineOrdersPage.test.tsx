import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import OnlineOrdersPage from './OnlineOrdersPage';

const apiGet = vi.fn();
const apiPatch = vi.fn();

vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
  },
  getErrorMessage: (e: any) => e?.message ?? 'error',
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

const order = {
  id: 'oo-1',
  orderNumber: 'OO-2026-0001',
  customerName: 'ทดสอบ ลูกค้า',
  phone: '0812345678',
  status: 'PENDING_BANK_REVIEW',
  totalAmount: 12500,
  createdAt: new Date().toISOString(),
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

// B5 fix round 1/5 [reversal]: confirmBankTransfer can come back either PAID (normal)
// or PAYMENT_RECEIVED_UNFULFILLABLE (device sold/gone before the slip was confirmed —
// customer needs a refund). The admin toast must distinguish these, not show a blanket
// "success" regardless of what the backend actually did.
describe('OnlineOrdersPage — ยืนยันสลิป toast reflects returned status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockResolvedValue({ data: { data: [order], total: 1 } });
  });

  it('confirm-bank returns PAID → toast.success (normal path)', async () => {
    apiPatch.mockResolvedValue({ data: { ...order, status: 'PAID' } });
    render(wrap(<OnlineOrdersPage />));

    const btn = await screen.findByText('ยืนยันสลิป');
    fireEvent.click(btn);

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/admin/online-orders/oo-1/confirm-bank'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('ยืนยันการรับเงินเรียบร้อย'));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('confirm-bank returns PAYMENT_RECEIVED_UNFULFILLABLE → toast.error (refund needed, not a plain success)', async () => {
    apiPatch.mockResolvedValue({ data: { ...order, status: 'PAYMENT_RECEIVED_UNFULFILLABLE' } });
    render(wrap(<OnlineOrdersPage />));

    const btn = await screen.findByText('ยืนยันสลิป');
    fireEvent.click(btn);

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/admin/online-orders/oo-1/confirm-bank'));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        expect.stringContaining('คืนเงิน'),
      ),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
