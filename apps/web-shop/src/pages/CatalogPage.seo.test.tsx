import type { ReactNode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import CatalogPage from './CatalogPage';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get } }));
vi.mock('@/components/layout/ShopLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

// ผลตรวจ SEO 27 พ.ย. 2569 ข้อ 13 (เจ้าของเลือก 27 พ.ย.): หัวข้อในผลค้นหาต้องมีคำที่คนค้น
// — เปลี่ยนเฉพาะ <title> ชื่อเมนู/breadcrumb "สินค้าทั้งหมด" คงเดิม
it('หัวข้อในผลค้นหาของ /products มีคำว่า iPhone มือสอง ผ่อน บัตรประชาชน', async () => {
  // รูปคำตอบเดียวกับ CatalogPage.down.test.tsx (แถบกรองต้องใช้ monthsOptions ฯลฯ)
  get.mockImplementation((url: string) =>
    Promise.resolve(
      url.startsWith('/api/shop/models')
        ? { data: [] }
        : {
            data: {
              data: [],
              total: 0,
              page: 1,
              limit: 12,
              minDownPct: 15,
              monthsOptions: [10, 12],
              freeDownCount: 0,
              overBudgetCount: 0,
              nextDownFrom: null,
            },
          },
    ),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/products']}>
        <CatalogPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(document.title).toBe(
      'iPhone มือ 1 และมือสอง ผ่อนบัตรประชาชนใบเดียว | BESTCHOICE ลพบุรี',
    ),
  );
});
