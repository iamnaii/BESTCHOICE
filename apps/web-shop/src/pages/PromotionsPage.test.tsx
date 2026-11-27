import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import PromotionsPage from './PromotionsPage';

vi.mock('@/lib/api', () => ({ api: { get: vi.fn(() => new Promise(() => {})) } }));
vi.mock('@/components/layout/ShopLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

// SEO audit 27 พ.ย. 2569 ข้อ 7: หน้านี้ไม่มี H1 — หัวข้อบนสุดต้องเป็น H1 ส่วนหัวข้อย่อยคง H2
it('หัวข้อ "โปรโมชัน" เป็น H1 หนึ่งเดียวของหน้า', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PromotionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  const h1s = screen.getAllByRole('heading', { level: 1 });
  expect(h1s).toHaveLength(1);
  expect(h1s[0]).toHaveTextContent('โปรโมชัน');
});
