import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

// Heavy children stubbed out — this spec asserts ONLY the default period range
// (PR #1327: "เดือนนี้" default = the FULL calendar month, owner 2026-07-02).
vi.mock('@/components/payment/SlipReviewTab', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/payment/PaymentHistorySheet', () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock('@/components/ToleranceApprovalDialog', () => ({
  ToleranceApprovalDialog: () => null,
}));
vi.mock('../components/ReceiptsTab', () => ({ __esModule: true, default: () => null }));
vi.mock('../components/PaymentFilters', () => ({ __esModule: true, default: () => null }));
vi.mock('../components/PaymentTable', () => ({ __esModule: true, default: () => null }));
vi.mock('../components/PaymentSummary', () => ({ __esModule: true, default: () => null }));
vi.mock('../components/PaymentModals', () => ({
  RecordPaymentModal: () => null,
  BatchPaymentModal: () => null,
}));
vi.mock('../components/RecordPaymentWizard', () => ({ RecordPaymentWizard: () => null }));
// Render the page's period + KPI-label state as plain text so the default
// range is directly observable.
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

import PaymentsPage from '../index';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PaymentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PaymentsPage — default period range (PR #1327)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/payments/pending-summary')) return { data: {} };
      if (url.startsWith('/payments/pending')) return { data: { data: [] } };
      throw new Error(`unexpected url ${url}`);
    });
    // Freeze ONLY Date (timers stay real so waitFor keeps working). The page
    // computes its default range from LOCAL time, so anchor the clock with a
    // local-time constructor: 2026-07-01 00:30 local. On an Asia/Bangkok
    // machine this instant is 2026-06-30T17:30:00Z — the month boundary where
    // any toISOString()-based date math would shift back to 2026-06-30.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 1, 0, 30, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults dueFrom/dueTo to the FULL current month and queries the queue + KPI with that window', async () => {
    renderPage();

    // Default state = 1st → LAST day of the current month (not "today").
    expect(screen.getByTestId('period-bar')).toHaveTextContent('2026-07-01|2026-07-31');

    // Both dueDate-scoped queries fire with the full-month window.
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/payments/pending?dueFrom=2026-07-01&dueTo=2026-07-31');
    });
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/payments/pending-summary?dueFrom=2026-07-01&dueTo=2026-07-31',
      );
    });
  });

  it("labels the collected KPI 'รับชำระเดือนนี้' for the default range", () => {
    renderPage();

    // The label compares state against the full-month "เดือนนี้" preset — if the
    // default were [1st, today] the comparison would fall through to
    // 'รับชำระช่วงนี้' (the pre-#1327 regression).
    expect(screen.getByTestId('collected-label')).toHaveTextContent(/^รับชำระเดือนนี้$/);
  });
});
