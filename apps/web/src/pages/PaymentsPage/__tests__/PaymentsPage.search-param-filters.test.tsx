vi.mock('@/components/payment/PaymentApprovalQueue', () => ({ default: () => null }));
vi.mock('@/components/payment/PaymentApprovalRequestDialog', () => ({ default: () => null }));
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

// Heavy children stubbed out — this spec asserts ONLY the ?search= initial-filter
// behaviour added for R6 (CustomerDetailPage's "รับชำระ" button links here).
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

function renderPage(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <PaymentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PaymentsPage — เปิดจากลิงก์ ?search= (R6: ปุ่ม "รับชำระ" หน้ารายละเอียดลูกค้า)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/payments/pending-summary')) return { data: {} };
      if (url.startsWith('/payments/pending')) return { data: { data: [] } };
      throw new Error(`unexpected url ${url}`);
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 1, 0, 30, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('เปิดด้วย ?search=CT-2569-0042 → ค้นด้วยเลขสัญญานั้น ไม่ล็อกช่วงวันที่ (ทั้งหมด แทนเดือนนี้)', async () => {
    renderPage('/payments?search=CT-2569-0042');

    // ไม่ล็อกช่วงวันที่ — งวดค้างจากเดือนก่อนต้องยังเห็น ไม่ใช่ถูกกรองด้วยหน้าต่างเดือนนี้เริ่มต้น
    // ต้องตรงทั้งข้อความ — toHaveTextContent('|') เป็น substring จึงผ่านแม้วันที่ไม่ว่าง
    expect(screen.getByTestId('period-bar')).toHaveTextContent(/^\|$/);

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/payments/pending?search=CT-2569-0042');
    });
    // ต้องไม่มี dueFrom/dueTo ติดไปกับคำขอ
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringContaining('dueFrom'));
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringContaining('dueTo'));
  });

  it('เปิดไม่มี ?search= → ยังคงค่าเริ่มต้นเดิม (เดือนนี้เต็มเดือน)', async () => {
    renderPage('/payments');

    expect(screen.getByTestId('period-bar')).toHaveTextContent('2026-07-01|2026-07-31');
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/payments/pending?dueFrom=2026-07-01&dueTo=2026-07-31');
    });
  });
});
