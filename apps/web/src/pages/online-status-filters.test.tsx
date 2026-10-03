import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import OnlineOrdersPage from './OnlineOrdersPage';
import InstallmentApplicationsPage from './InstallmentApplicationsPage';
import SavingPlansAdminPage from './SavingPlansAdminPage';

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  default: { get: vi.fn() },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'OWNER' } }) }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.get).mockResolvedValue({ data: { data: [] } });
});

it.each([
  {
    Page: OnlineOrdersPage,
    path: '/admin/online-orders',
    status: 'PAYMENT_RECEIVED_UNFULFILLABLE',
    label: 'ต้องคืนเงิน',
  },
  {
    Page: InstallmentApplicationsPage,
    path: '/admin/installment-applications',
    status: 'SUBMITTED',
    label: 'รอจัดคิว',
  },
  { Page: SavingPlansAdminPage, path: '/admin/saving-plans', status: 'ACTIVE', label: 'กำลังออม' },
])(
  '$path filters preserve status values and ALL omits the parameter',
  async ({ Page, path, status, label }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(path));
    const all = screen.getByRole('button', { name: 'ทั้งหมด' });
    const filtered = screen.getByRole('button', { name: label });
    expect(all).toHaveClass('bg-primary');
    fireEvent.click(filtered);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(`${path}?status=${status}`));
    expect(filtered).toHaveClass('bg-primary');
    expect(all).not.toHaveClass('bg-primary');
    vi.mocked(api.get).mockClear();
    fireEvent.click(all);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(path));
    expect(all).toHaveClass('bg-primary');
    expect(filtered).not.toHaveClass('bg-primary');
  },
);
