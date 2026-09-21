/**
 * "รับโอนหน้าร้าน" button (2026-09-05): shown only for repossession rows whose 11-2107
 * SHOP_COLLECT balance is still outstanding (`shopCollectOutstanding > 0`) — previously it
 * rendered on every row and 400'd on click. The dialog prefills the outstanding amount.
 * Manual "ขายแล้ว" is gone from the manage modal (POS closes the row itself).
 */
import type { ReactNode } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...a: unknown[]) => apiGet(...a), post: vi.fn(), patch: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-owner', name: 'เจ้าของ', role: 'OWNER', branchId: null },
    isLoading: false,
  }),
}));
vi.mock('@/pages/PaymentsPage/components/RepossessionOverlay', () => ({
  RepossessionOverlay: () => <div data-testid="repo-overlay" />,
}));
vi.mock('@/components/contract/ContractJournalDialog', () => ({ default: () => null }));

import RepossessionsPage from './RepossessionsPage';

const repo = (over: Record<string, unknown>) => ({
  id: 'repo-1',
  repossessedDate: '2026-09-01T00:00:00.000Z',
  conditionGrade: 'B',
  appraisalPrice: '7000.00',
  repairCost: '0',
  resellPrice: null,
  status: 'READY_FOR_SALE',
  notes: null,
  customerRefundEnabled: false,
  customerRefund: null,
  shopCollectOutstanding: '0.00',
  deviceReturnOutstanding: '0.00',
  contract: {
    id: 'c-1',
    contractNumber: 'TEST-20260905-010',
    sellingPrice: '20000.00',
    financedAmount: '17000.00',
    customer: { id: 'cu1', name: 'ลูกค้า', phone: '0800000000' },
    branch: { id: 'b1', name: 'ลาดพร้าว' },
  },
  product: { id: 'p1', name: 'Galaxy S24', brand: 'Samsung', model: 'S24', imeiSerial: null },
  appraisedBy: { id: 'u-owner', name: 'เจ้าของ' },
  creditNote: null,
  ...over,
});

function routeApi(rows: unknown[]) {
  apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/device-returns/awaiting-repossession'))
      return Promise.resolve({ data: { data: [], total: 0 } });
    if (url.startsWith('/device-returns?'))
      return Promise.resolve({ data: { data: [], total: 0, page: 1, limit: 100 } });
    if (url.startsWith('/repossessions/profit-loss')) return Promise.resolve({ data: {} });
    if (url.startsWith('/repossessions'))
      return Promise.resolve({ data: { data: rows, total: rows.length } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('RepossessionsPage — รับโอนหน้าร้าน / ขายแล้ว', () => {
  it('hides the settlement button when nothing is parked on 11-2107 for the contract', async () => {
    routeApi([repo({ shopCollectOutstanding: '0.00' })]);
    render(<RepossessionsPage />, { wrapper });
    await screen.findByText('TEST-20260905-010');
    expect(screen.queryByRole('button', { name: 'รับโอนหน้าร้าน' })).not.toBeInTheDocument();
  });

  it('shows the settlement button and prefills the outstanding 11-2107 amount', async () => {
    routeApi([repo({ shopCollectOutstanding: '7000.00' })]);
    render(<RepossessionsPage />, { wrapper });
    await screen.findByText('TEST-20260905-010');

    fireEvent.click(screen.getByRole('button', { name: 'รับโอนหน้าร้าน' }));

    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByPlaceholderText('0.00') as HTMLInputElement;
    expect(amount.value).toBe('7000');
  });

  it('no longer offers "ขายแล้ว" as a manual status for a READY_FOR_SALE row', async () => {
    routeApi([repo({ status: 'READY_FOR_SALE', resellPrice: '7500.00' })]);
    render(<RepossessionsPage />, { wrapper });
    await screen.findByText('TEST-20260905-010');

    fireEvent.click(screen.getByRole('button', { name: 'จัดการ' }));

    const dialog = await screen.findByRole('dialog');
    const options = within(dialog)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toContain('READY_FOR_SALE');
    expect(options).not.toContain('SOLD');
  });

  it('shows the "รอหักในรอบจ่าย" badge when 11-2107 DEVICE_RETURN is still outstanding', async () => {
    routeApi([repo({ deviceReturnOutstanding: '7000.00' })]);
    render(<RepossessionsPage />, { wrapper });
    await screen.findByText('TEST-20260905-010');
    expect(screen.getByText(/รอหักในรอบจ่าย 7,000 ฿/)).toBeInTheDocument();
    // ปุ่มรับโอนหน้าร้านยังผูกกับ SHOP_COLLECT เดิมเท่านั้น
    expect(screen.queryByRole('button', { name: 'รับโอนหน้าร้าน' })).not.toBeInTheDocument();
  });
});
