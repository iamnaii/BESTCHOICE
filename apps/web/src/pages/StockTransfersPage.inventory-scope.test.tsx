import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { it, expect, vi } from 'vitest';
import StockTransfersPage from './StockTransfersPage';
const mock = vi.hoisted(() => ({ get: vi.fn(async () => ({ data: [] })) }));
vi.mock('@/lib/api', () => ({ default: { get: mock.get }, getErrorMessage: () => 'error' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'OWNER' } }) }));
it('keeps the pending destination and category from the overview and lets the user clear it', async () => {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter
        initialEntries={[
          '/stock/transfers?view=outgoing&status=PENDING&inventoryScope=devices&branchId=b',
        ]}
      >
        <StockTransfersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(mock.get).toHaveBeenCalledWith(
      '/products/transfers/pending',
      expect.objectContaining({ params: { inventoryScope: 'devices', branchId: 'b' } }),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรองจากภาพรวม' }));
  await waitFor(() =>
    expect(mock.get).toHaveBeenCalledWith(
      '/products/transfers/pending',
      expect.objectContaining({ params: {} }),
    ),
  );
});
