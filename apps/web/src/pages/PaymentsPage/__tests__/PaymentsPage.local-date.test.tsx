import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

const exportToExcel = vi.fn();
vi.mock('@/utils/excel.util', () => ({
  __esModule: true,
  exportToExcel: (...args: unknown[]) => exportToExcel(...args),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', role: 'SALES', defaultCashAccountCode: '11-1101' },
  }),
}));

// Heavy children stubbed out — this spec asserts ONLY the LOCAL-date defaults
// (same toISOString-before-07:00-BKK bug class PR #1327 fixed for date ranges).
vi.mock('@/components/payment/SlipReviewTab', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/payment/PaymentHistorySheet', () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock('@/components/ToleranceApprovalDialog', () => ({
  ToleranceApprovalDialog: () => null,
}));
vi.mock('../components/ReceiptsTab', () => ({ __esModule: true, default: () => null }));
// Expose the export trigger so the Excel filename date is observable.
vi.mock('../components/PaymentFilters', () => ({
  __esModule: true,
  default: ({ onExport }: { onExport: () => void }) => (
    <button data-testid="export-excel" onClick={onExport}>
      export
    </button>
  ),
}));
// Expose the pay trigger so openPayModal's payForm re-seed is observable.
vi.mock('../components/PaymentTable', () => ({
  __esModule: true,
  default: ({ onOpenPayModal }: { onOpenPayModal: (p: unknown) => void }) => (
    <button
      data-testid="open-pay-modal"
      onClick={() => onOpenPayModal({ amountDue: '1515.83', lateFee: '0', amountPaid: '0' })}
    >
      pay
    </button>
  ),
}));
vi.mock('../components/PaymentPeriodBar', () => ({ __esModule: true, default: () => null }));
vi.mock('../components/PaymentKpiCards', () => ({ __esModule: true, default: () => null }));
vi.mock('../components/RecordPaymentWizard', () => ({ RecordPaymentWizard: () => null }));
// Render the page's summaryDate state as plain text so the daily-summary tab
// default is directly observable.
vi.mock('../components/PaymentSummary', () => ({
  __esModule: true,
  default: ({ summaryDate }: { summaryDate: string }) => (
    <div data-testid="summary-date">{summaryDate}</div>
  ),
}));
// Render payForm.paidDate (the RECORDED PAYMENT DATE default — money-impacting)
// plus a close trigger so the onClose reset path is observable too.
vi.mock('../components/PaymentModals', () => ({
  RecordPaymentModal: ({ payForm, onClose }: { payForm: { paidDate: string }; onClose: () => void }) => (
    <div>
      <div data-testid="paid-date">{payForm.paidDate}</div>
      <button data-testid="close-pay-modal" onClick={onClose}>
        close
      </button>
    </div>
  ),
  BatchPaymentModal: () => null,
}));

import PaymentsPage from '../index';

function renderPage(initialEntry = '/payments') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <PaymentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PaymentsPage — LOCAL-date defaults (toISOString bug class, PR #1327)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/payments/daily-summary')) return { data: {} };
      if (url.startsWith('/payments/pending-summary')) return { data: {} };
      if (url.startsWith('/payments/pending')) return { data: { data: [] } };
      throw new Error(`unexpected url ${url}`);
    });
    // Freeze ONLY Date (timers stay real so waitFor keeps working). The page
    // must compute its date defaults from LOCAL time, so anchor the clock with
    // a local-time constructor: 2026-07-03 01:30 local. On an Asia/Bangkok
    // machine this instant is 2026-07-02T18:30:00Z — before 07:00 BKK, where
    // any toISOString()-based default yields YESTERDAY (2026-07-02).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 3, 1, 30, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults the daily-summary date to the LOCAL date and queries with it', async () => {
    renderPage('/payments?tab=summary');

    // Before 07:00 BKK the UTC date is still yesterday — the default must be
    // the LOCAL calendar day, not toISOString()'s UTC day.
    expect(screen.getByTestId('summary-date')).toHaveTextContent(/^2026-07-03$/);

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/payments/daily-summary?date=2026-07-03');
    });
  });

  it('defaults payForm.paidDate (recorded payment date) to the LOCAL date', () => {
    renderPage();

    expect(screen.getByTestId('paid-date')).toHaveTextContent(/^2026-07-03$/);
  });

  it('keeps payForm.paidDate on the LOCAL date after the pay modal resets on close', () => {
    renderPage();

    // onClose re-seeds payForm with a fresh default — that reset must use the
    // LOCAL date too, or reopening the modal brings the UTC-yesterday bug back.
    fireEvent.click(screen.getByTestId('close-pay-modal'));

    expect(screen.getByTestId('paid-date')).toHaveTextContent(/^2026-07-03$/);
  });

  it('re-seeds payForm.paidDate with the LOCAL date when opening the pay flow', async () => {
    renderPage();

    // openPayModal re-seeds payForm from scratch — the symmetric path to the
    // onClose reset; it must not reintroduce the toISOString UTC-yesterday bug.
    await waitFor(() => screen.getByTestId('open-pay-modal'));
    fireEvent.click(screen.getByTestId('open-pay-modal'));

    expect(screen.getByTestId('paid-date')).toHaveTextContent(/^2026-07-03$/);
  });

  it('stamps the Excel export filename with the LOCAL date', async () => {
    renderPage();

    await waitFor(() => screen.getByTestId('export-excel'));
    fireEvent.click(screen.getByTestId('export-excel'));

    await waitFor(() => expect(exportToExcel).toHaveBeenCalled());
    expect(exportToExcel).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'pending-payments-2026-07-03.xlsx' }),
    );
  });
});
