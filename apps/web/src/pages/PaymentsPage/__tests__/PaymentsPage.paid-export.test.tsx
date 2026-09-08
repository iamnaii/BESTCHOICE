vi.mock('@/components/payment/PaymentApprovalQueue', () => ({ default: () => null }));
vi.mock('@/components/payment/PaymentApprovalRequestDialog', () => ({ default: () => null }));
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
  },
  getErrorMessage: (e: unknown) => String(e),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', role: 'SALES', defaultCashAccountCode: '11-1101' },
  }),
}));

// Keep the real paid-export handler; unrelated payment flows are stubbed.
vi.mock('@/components/payment/SlipReviewTab', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/payment/PaymentHistorySheet', () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock('@/components/ToleranceApprovalDialog', () => ({
  ToleranceApprovalDialog: () => null,
}));
vi.mock('../components/ReceiptsTab', () => ({ __esModule: true, default: () => null }));
vi.mock('../components/PaymentFilters', () => ({ __esModule: true, default: ({ onExport }: { onExport: () => void }) => <button onClick={onExport}>ส่งออกทดสอบ</button> }));
vi.mock('../components/PaymentTable', () => ({ __esModule: true, default: ({ pendingPayments }: { pendingPayments: unknown[] }) => <div>{`rows:${pendingPayments.length}`}</div> }));
vi.mock('../components/PaymentSummary', () => ({ __esModule: true, default: () => null }));
vi.mock('../components/PaymentModals', () => ({
  RecordPaymentModal: () => null,
  BatchPaymentModal: () => null,
}));
vi.mock('../components/RecordPaymentWizard', () => ({ RecordPaymentWizard: () => null }));
// Lightweight period/KPI mocks keep this test focused on exported money.
vi.mock('../components/PaymentPeriodBar', () => ({
  __esModule: true,
  default: ({ startDate, endDate }: { startDate: string; endDate: string }) => (
    <div data-testid="period-bar">{`${startDate}|${endDate}`}</div>
  ),
}));
vi.mock('../components/PaymentKpiCards', () => ({
  __esModule: true,
  default: ({ collectedLabel }: { collectedLabel: string }) => (
    <div data-testid="collected-label">{collectedLabel}</div>
  ),
}));


const exportToExcel = vi.fn().mockResolvedValue(undefined);
vi.mock('@/utils/excel.util', () => ({ exportToExcel: (...args: unknown[]) => exportToExcel(...args) }));
import PaymentsPage from '../index';

describe('PaymentsPage paid export — receipt cash', () => {
  it('exports receipt cash and unavailable evidence without overwriting installment obligations', async () => {
    const rows = [
      { id: 'bundle', receiptCashAmount: '5516.00' },
      { id: 'last', receiptCashAmount: '3428.00' },
      { id: 'unknown', receiptCashAmount: null },
    ].map((value, index) => ({ ...value, installmentNo: index + 1, amountDue: '4472', amountPaid: '4472', lateFee: '0', status: 'PAID', dueDate: '2026-09-08', paidDate: '2026-09-08', notes: '', contract: { id: 'contract', contractNumber: 'TEST-PAID', customer: { name: 'ลูกค้าจำลอง', phone: '0800000000' }, branch: { name: 'สาขาจำลอง' } } }));
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/payments/pending-summary')) return { data: {} };
      if (url.startsWith('/payments/pending?')) return { data: { data: rows, total: rows.length } };
      return { data: [] };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/payments?tab=paid']}><PaymentsPage /></MemoryRouter></QueryClientProvider>);
    await screen.findByText('rows:3');
    fireEvent.click(screen.getByRole('button', { name: 'ส่งออกทดสอบ' }));
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledTimes(1));
    expect(exportToExcel.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ amountDue: '4,472', amountPaid: '5,516' }),
      expect.objectContaining({ amountDue: '4,472', amountPaid: '3,428' }),
      expect.objectContaining({ amountDue: '4,472', amountPaid: '–' }),
    ]);
  });
});
