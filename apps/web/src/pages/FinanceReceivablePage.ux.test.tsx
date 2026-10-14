import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...args: unknown[]) => apiGet(...args) },
  getErrorMessage: () => 'ไม่สามารถโหลดข้อมูลได้',
}));
import FinanceReceivablePage from './FinanceReceivablePage';
const summary = {
  totalPending: 0,
  totalReceived: 0,
  totalOverdue: 0,
  totalDisputed: 0,
  pendingAmount: '0',
  receivedAmount: '0',
  overdueAmount: '0',
  disputedAmount: '0',
};
function mount(path = '/finance-receivable?startDate=2000-01-01&page=3') {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <FinanceReceivablePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const latestQuery = () =>
  new URL(
    [...apiGet.mock.calls].reverse().find(([path]) => path.startsWith('/finance-receivable?'))![0],
    'https://example.invalid',
  ).searchParams;
beforeEach(() => {
  apiGet
    .mockReset()
    .mockImplementation((path: string) =>
      Promise.resolve({
        data:
          path.startsWith('/branches') || path.includes('/companies')
            ? []
            : path.includes('/summary')
              ? summary
              : { data: [], total: 0 },
      }),
    );
});
describe('receivable date filters and failed reads', () => {
  it('sets both date boundaries atomically and clears both with All', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T17:30:00Z'));
    try {
      mount();
      await userEvent.click(screen.getByRole('button', { name: 'เดือนนี้' }));
      await waitFor(() => expect(latestQuery().get('startDate')).toBe('2026-10-01'));
      expect(latestQuery().get('endDate')).toBe('2026-10-01');
      expect(latestQuery().get('page')).toBe('1');
      await userEvent.click(screen.getByRole('button', { name: 'ทั้งหมด' }));
      await waitFor(() => expect(latestQuery().has('startDate')).toBe(false));
      expect(latestQuery().has('endDate')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
  it('shows a recoverable error instead of an empty list when the read fails', async () => {
    apiGet.mockImplementation((path: string) =>
      path.startsWith('/finance-receivable?')
        ? Promise.reject({ response: { status: 500 } })
        : Promise.resolve({ data: path.includes('/summary') ? summary : [] }),
    );
    mount();
    expect(
      await screen.findByRole('heading', { name: 'ไม่สามารถโหลดรายการเงินรับได้' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('ไม่พบรายการเงินรับจากไฟแนนซ์')).not.toBeInTheDocument();
    expect(screen.queryByText('ทั้งหมด 0 รายการ')).not.toBeInTheDocument();
  });
});
