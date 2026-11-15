import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({
  default: { get: apiGet, post: vi.fn(), patch: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import StockTransfersPage from './StockTransfersPage';

describe('StockTransfersPage — S2-04 ตัวกรองไม่ยืดเต็มจอ ทั้ง 3 แท็บ', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ data: [] });
  });

  it.each([
    ['outgoing', 'สถานะ'],
    ['incoming', 'สาขา'],
    ['history', 'สาขา'],
  ])('แท็บ %s: dropdown "%s" wrapper = w-full sm:w-56', async (view, name) => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/stock/transfers?view=${view}`]}>
          <StockTransfersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const select = await screen.findByRole('combobox', { name });
    const wrap = select.closest('[data-slot="native-select-wrapper"]');
    expect(wrap).toHaveClass('w-full', 'sm:w-56');
    expect(wrap).not.toHaveClass('w-auto');
  });
});
