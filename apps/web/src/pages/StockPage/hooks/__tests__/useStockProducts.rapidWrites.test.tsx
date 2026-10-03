import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStockProducts } from '../useStockProducts';

/**
 * พี่น้องของ `CustomersPage/__tests__/useCustomersQuery.rapidWrites.test.tsx` — บั๊กเดียวกัน
 *
 * ตัวเขียน URL ของหน้ารายการสินค้าตั้งต้นจาก `searchParams` ใน closure ของ render ล่าสุด
 * เขียนสองครั้งก่อนจอ render ใหม่ ครั้งที่สองจึงทับครั้งแรก: เลือกสาขาแล้วกดเรียงทันที ⇒
 * ตัวกรองสาขาหายเงียบ ๆ เรียกสองคำสั่งใน `act` เดียว = ไม่มี render คั่นกลาง
 */

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorMessage: () => 'โหลดไม่สำเร็จ',
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'OWNER' } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function setup(initialUrl: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(() => ({ q: useStockProducts(), location: useLocation() }), { wrapper });
}

const paramsOf = (search: string) => Object.fromEntries(new URLSearchParams(search));

describe('useStockProducts — เขียน URL ติดกันก่อน render', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.get.mockImplementation((url: string) =>
      Promise.resolve({
        data:
          url === '/branches'
            ? []
            : { data: [], total: 0, page: 1, limit: 50, totalPages: 0, viewCounts: { ready: 0, all: 0 } },
      }),
    );
  });

  it('เลือกสาขาแล้วกดเรียงทันที — ตัวกรองสาขาต้องไม่หาย และ ?zone= ต้องอยู่', () => {
    const { result } = setup('/stock/products?zone=shop');

    act(() => {
      result.current.q.setFilterBranch('b1');
      result.current.q.setSort({ key: 'name', direction: 'asc' });
    });

    expect(paramsOf(result.current.location.search)).toEqual({
      zone: 'shop',
      branchId: 'b1',
      sortBy: 'name',
      sortDirection: 'asc',
    });
    expect(result.current.q.filterBranch).toBe('b1');
  });

  it('สลับมุมมอง "ทั้งหมด" แล้วเลือกสถานะทันที — มุมมองต้องไม่เด้งกลับ', () => {
    const { result } = setup('/stock/products');

    act(() => {
      result.current.q.setView('all');
      result.current.q.setFilterStatus('RESERVED');
    });

    expect(paramsOf(result.current.location.search)).toEqual({
      view: 'all',
      status: 'RESERVED',
    });
  });

  it('เลือกประเภทแล้วกดหน้าถัดไปทันที — ตัวกรองประเภทต้องไม่หาย', () => {
    const { result } = setup('/stock/products');

    act(() => {
      result.current.q.setFilterCategory('PHONE_USED');
      result.current.q.setPage(2);
    });

    expect(paramsOf(result.current.location.search)).toEqual({
      category: 'PHONE_USED',
      page: '2',
    });
  });
});
