import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openCombobox, pickComboOption } from '@/test/combobox';
import SalesHistoryPage from '../SalesHistoryPage';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => apiGet(...args), post: vi.fn() },
  getErrorMessage: () => 'เกิดข้อผิดพลาด',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() } }));
let mockRole = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me', role: mockRole, branchId: 'b1' }, isLoading: false, isAuthenticated: true }),
}));

const salespersons = [
  { id: 'sp-1', name: 'สมชาย ขายดี' },
  { id: 'sp-2', name: 'สมหญิง ขายเก่ง' },
];

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const listUrls = () =>
  apiGet.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith('/sales?'));

beforeEach(() => {
  apiGet.mockReset();
  mockRole = 'OWNER';
  apiGet.mockImplementation(async (url: string) => {
    if (url === '/sales/salespersons') return { data: salespersons };
    if (url.startsWith('/sales?')) {
      return {
        data: {
          data: [], total: 0, page: 1, limit: 20, totalPages: 1,
          summary: {
            totalAmount: 0, totalDiscount: 0, totalProfit: 0, cashCount: 0, cashAmount: 0,
            installmentCount: 0, installmentAmount: 0, financeCount: 0, financeAmount: 0,
          },
        },
      };
    }
    return { data: [] };
  });
});

describe('SalesHistoryPage — พนักงานขาย (Combobox)', () => {
  it('OWNER picks a salesperson → the list request carries salespersonId; ทุกพนักงาน drops it', async () => {
    const user = userEvent.setup();
    render(<SalesHistoryPage />, { wrapper });
    const trigger = await screen.findByRole('combobox', { name: 'พนักงานขาย' });
    expect(trigger).toHaveTextContent('ทุกพนักงาน');

    await openCombobox(user, 'พนักงานขาย');
    await user.click(await screen.findByRole('option', { name: 'สมหญิง ขายเก่ง' }));
    await waitFor(() => expect(listUrls().at(-1)).toMatch(/[?&]salespersonId=sp-2(&|$)/));
    expect(trigger).toHaveTextContent('สมหญิง ขายเก่ง');

    await pickComboOption(user, 'พนักงานขาย', 'ทุกพนักงาน');
    await waitFor(() => expect(listUrls().at(-1)).not.toMatch(/salespersonId=/));
  });

  it('SALES does not see the field and never asks for /sales/salespersons', async () => {
    mockRole = 'SALES';
    render(<SalesHistoryPage />, { wrapper });
    await waitFor(() => expect(listUrls().length).toBeGreaterThan(0));
    expect(screen.queryByRole('combobox', { name: 'พนักงานขาย' })).toBeNull();
    expect(apiGet).not.toHaveBeenCalledWith('/sales/salespersons');
  });
});
