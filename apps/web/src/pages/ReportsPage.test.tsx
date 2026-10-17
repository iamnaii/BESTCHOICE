import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import React from 'react';

const apiGet = vi.fn();
const auth = vi.hoisted(() => ({ role: 'OWNER' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: auth }) }));
vi.mock('@/components/ui/animated-counter', () => ({ default: ({ value, decimals }: { value: number; decimals?: number }) => <span data-decimals={decimals}>{value.toLocaleString()}</span> }));
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
  },
}));

import ReportsPage from './ReportsPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(MemoryRouter, null, React.createElement(ReportsPage)),
    ),
  );
}

describe('ReportsPage — EntityProfitReport default date range (PR #1327)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/reports/aging')) return { data: {} };
      if (url.startsWith('/reports/entity-profit')) return { data: {} };
      throw new Error(`unexpected url ${url}`);
    });
    // Freeze ONLY Date (timers stay real so waitFor keeps working). The report
    // computes its default range from LOCAL time, so anchor the clock with a
    // local-time constructor: 2026-07-01 00:30 local. On an Asia/Bangkok
    // machine this instant is 2026-06-30T17:30:00Z — the exact month-boundary
    // where the pre-fix toISOString() code shifted firstDay back to 2026-06-30
    // (last day of the PREVIOUS month).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 1, 0, 30, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to the FULL current local month — no UTC shift on firstDay/lastDay', async () => {
    renderPage();

    // Switch to the กำไร Shop/Finance tab (EntityProfitReport).
    fireEvent.click(screen.getByRole('button', { name: 'กำไร Shop/Finance' }));

    // The report query must use the local-month boundaries — NOT the
    // UTC-shifted 2026-06-30 start the old toISOString() code produced, and
    // NOT "today" as the end.
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/reports/entity-profit?startDate=2026-07-01&endDate=2026-07-31',
      );
    });

    // Default = full current month → the "เดือนนี้" chip reads active and the
    // label renders as the bare month name.
    expect(screen.getByRole('radio', { name: 'เดือนนี้' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByTestId('date-range-label')).toHaveTextContent(/^กรกฎาคม 2569$/);
  });
});

describe('ReportsPage — current API response contracts', () => {
  beforeEach(() => {
    auth.role = 'OWNER';
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/reports/aging')) return { data: { '1-30': { count: 2, totalOutstanding: 1234 }, total: { count: 2, totalOutstanding: 1234 } } };
      if (url.startsWith('/reports/revenue-pl')) return { data: { revenue: { interestIncome: 150, lateFeeIncome: 25, totalPaymentsReceived: 3456, paymentCount: 2 } } };
      if (url.startsWith('/reports/high-risk')) return { data: { data: [{ contractNumber: url.includes('page=2') ? 'RISK-51' : 'RISK-01', customer: { name: 'ลูกค้าทดสอบ', phone: '0800000000' }, overdueInstallments: 4, totalOutstanding: 4321 }], total: 51, page: url.includes('page=2') ? 2 : 1, limit: 50 } };
      if (url.startsWith('/reports/sales-comparison')) return { data: { data: [{ salespersonId: 's1', name: 'ผู้ขายทดสอบ', totalContracts: 8, totalSales: 54321, overdueCount: 1, overdueRate: '12.5' }], total: 1, page: 1, limit: 50 } };
      if (url.startsWith('/reports/branch-comparison')) return { data: [{ branchId: 'b1', branchName: 'สาขาทดสอบ', newContracts: 3, activeContracts: 7, overdueContracts: 2, paymentsReceived: 6789, inStockProducts: 9 }] };
      if (url.startsWith('/reports/daily-payments')) return { data: { totalPayments: 51, totalAmount: 7654, byMethod: { CASH: { count: 1, total: 1000 }, BANK_TRANSFER: { count: 49, total: 6000 } }, byBranch: { 'สาขาทดสอบ': { count: 50, total: 7000 } }, total: 51, page: 1, limit: 50 } };
      if (url.startsWith('/reports/stock')) return { data: { totalInStock: 6, totalStockValue: 9876, byStatusAndBranch: [{ branch: 'สาขาทดสอบ', status: 'IN_STOCK', count: 6 }] } };
      throw new Error(`unexpected url ${url}`);
    });
  });
  afterEach(() => { auth.role = 'OWNER'; });

  it('reads installment aging and nested revenue; clearing a date never requests an invalid range', async () => {
    renderPage();
    const total = await screen.findByRole('row', { name: /รวม 2 1,234/ });
    expect(total).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'จำนวนงวด' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'รายได้ / กำไร-ขาดทุน' }));
    expect(await screen.findByText('3,456')).toBeVisible();
    expect(screen.getByText('3,456')).toHaveAttribute('data-decimals', '2');
    expect(screen.getByText('รายการรับชำระ')).toBeVisible();
    expect(apiGet.mock.calls.some(([url]) => /^\/reports\/revenue-pl\?startDate=\d{4}-\d{2}-01&endDate=\d{4}-\d{2}-\d{2}$/.test(url))).toBe(true);
    const count = apiGet.mock.calls.length;
    fireEvent.click(screen.getByLabelText('จากวันที่'));
    fireEvent.click(screen.getByRole('button', { name: /^ล้าง$/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('เลือกวันที่ให้ครบ');
    expect(screen.queryByText('3,456')).not.toBeInTheDocument();
    expect(apiGet.mock.calls).toHaveLength(count);
  });

  it('shows nested customer records and navigates beyond the first 50 contracts', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'ลูกค้าเสี่ยงสูง' }));
    expect(await screen.findByText('RISK-01')).toBeVisible();
    expect(screen.getByText('ลูกค้าทดสอบ')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }));
    expect(await screen.findByText('RISK-51')).toBeVisible();
    expect(screen.getByRole('button', { name: 'ถัดไป' })).toBeDisabled();
    expect(apiGet).toHaveBeenCalledWith('/reports/high-risk?page=2&limit=50');
  });

  it('renders string overdue percentages and actual branch counts', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'เปรียบเทียบพนักงาน' }));
    expect(await screen.findByText('12.5%')).toBeVisible();
    expect(screen.getByText('54,321')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'เปรียบเทียบสาขา' }));
    const row = await screen.findByRole('row', { name: /สาขาทดสอบ/ });
    expect(within(row).getAllByRole('cell').map(c => c.textContent)).toEqual(['สาขาทดสอบ', '3', '7', '2', '6,789', '9']);
  });

  it('keeps Previous available if the final page disappears while navigating', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'ลูกค้าเสี่ยงสูง' }));
    await screen.findByText('RISK-01');
    apiGet.mockResolvedValueOnce({ data: { data: [], total: 50, page: 2, limit: 50 } });
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }));
    await screen.findByText('ไม่พบข้อมูล');
    fireEvent.click(screen.getByRole('button', { name: 'ก่อนหน้า' }));
    expect(await screen.findByText('RISK-01')).toBeVisible();
  });

  it('labels current-page payment breakdowns and reads stock counts without inventing per-branch values', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'ชำระรายวัน' }));
    expect(await screen.findByText('7,654')).toBeVisible();
    expect(screen.getByText('เงินสด (หน้านี้)')).toBeVisible();
    expect(screen.getByText('โอน (หน้านี้)')).toBeVisible();
    expect(screen.getByRole('row', { name: /สาขาทดสอบ 50 7,000/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'สต็อกสินค้า' }));
    expect(await screen.findByText('9,876')).toBeVisible();
    expect(screen.getByRole('row', { name: /สาขาทดสอบ.*6/ })).toBeVisible();
  });

  it('does not offer report tabs forbidden to a branch manager', () => {
    auth.role = 'BRANCH_MANAGER';
    renderPage();
    expect(screen.queryByRole('button', { name: 'เปรียบเทียบสาขา' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'กำไร Shop/Finance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'เปรียบเทียบสาขา' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'กำไร Shop/Finance' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'สต็อกสินค้า' })).toBeVisible();
  });
});

describe('ReportsPage — toISOString UTC-shift bug (dateFilter default + CSV filename)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/reports/aging')) return { data: {} };
      if (url.startsWith('/reports/daily-payments')) return { data: {} };
      if (url.startsWith('/reports/export/contracts')) return { data: [{ contractNumber: 'TEST-CSV' }] };
      throw new Error(`unexpected url ${url}`);
    });
    // Freeze ONLY Date (timers stay real so waitFor keeps working). Anchor the
    // clock with a LOCAL-time constructor: 2026-07-03 01:30 local. On an
    // Asia/Bangkok machine this instant is 2026-07-02T18:30:00Z — before
    // 07:00 BKK, where new Date().toISOString().slice(0, 10) returns
    // YESTERDAY (2026-07-02) while the local calendar date is 2026-07-03.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 3, 1, 30, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('daily-payment tab defaults its date filter to the LOCAL date, not the UTC date', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'ชำระรายวัน' }));

    // The report query must use the local calendar day — NOT the UTC-shifted
    // 2026-07-02 the old toISOString() default produced.
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/reports/daily-payments?date=2026-07-03&page=1&limit=50');
    });
  });

  it('stamps the CSV export filename with the LOCAL date, not the UTC date', async () => {
    renderPage();

    // jsdom has no URL.createObjectURL — stub it, and capture the anchor the
    // export mutation creates so its download filename is observable. Spies
    // go in AFTER render so React's own element creation is not captured.
    window.URL.createObjectURL = vi.fn(() => 'blob:mock') as typeof URL.createObjectURL;
    window.URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const anchors: HTMLAnchorElement[] = [];
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) => {
      const el = realCreateElement(tagName, options);
      if (tagName === 'a') anchors.push(el as HTMLAnchorElement);
      return el;
    }) as typeof document.createElement);

    fireEvent.click(screen.getByRole('button', { name: 'ส่งออกสัญญา CSV' }));

    await waitFor(() => expect(anchors).toHaveLength(1));
    expect(anchors[0].download).toBe('contracts-export-2026-07-03.csv');
  });
});
