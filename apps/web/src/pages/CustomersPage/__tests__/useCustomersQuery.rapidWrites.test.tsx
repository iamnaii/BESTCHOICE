import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCustomersQuery } from '../hooks/useCustomersQuery';

/**
 * การเขียน URL ติดกันก่อนที่จอจะ render ทัน (บั๊กที่ E2E `sales-menu-regression` จับได้บน CI)
 *
 * `setSearchParams(prev => …)` ของ react-router **ไม่ได้ต่อคิวแบบ setState** — `prev` คือค่า
 * จาก render ล่าสุดของคอมโพเนนต์ ถ้าเขียนสองครั้งก่อน render ใหม่ ครั้งที่สองจะตั้งต้นจากค่าเก่า
 * แล้วทับครั้งแรกทิ้ง: เลือก "ระดับลูกค้า" แล้วกดเรียงทันที ⇒ ตัวกรองระดับหาย (ส่งออก Excel
 * ได้ข้อมูลไม่ตรงกับที่ผู้ใช้กรอง)
 *
 * เทสต์นี้เรียกสองคำสั่งใน `act` เดียว = ไม่มี render คั่นกลาง = จำลองสภาพนั้นแบบแน่นอน
 */

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  default: { get: mocks.get },
  getErrorMessage: () => 'โหลดไม่สำเร็จ',
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'OWNER' } }),
}));

function setup(initialUrl: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(() => ({ q: useCustomersQuery(), location: useLocation() }), { wrapper });
}

const paramsOf = (search: string) => Object.fromEntries(new URLSearchParams(search));

describe('useCustomersQuery — เขียน URL ติดกันก่อน render', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.get.mockResolvedValue({
      data: {
        data: [],
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 0,
        summary: {},
        viewCounts: { customers: 0, prospects: 0 },
      },
    });
  });

  it('เลือกระดับลูกค้าแล้วกดเรียงทันที — ตัวกรองระดับต้องไม่หาย และ ?zone= ต้องอยู่', () => {
    const { result } = setup('/customers?zone=shop');

    act(() => {
      result.current.q.setFilter('tier', 'GOLD');
      result.current.q.setSort({ key: 'name', direction: 'asc' });
    });

    expect(paramsOf(result.current.location.search)).toEqual({
      zone: 'shop',
      tier: 'GOLD',
      sortBy: 'name',
      sortDirection: 'asc',
    });
    expect(result.current.q.tier).toBe('GOLD');
    expect(result.current.q.buildParams(1, 50)).toMatchObject({
      tier: 'GOLD',
      sortBy: 'name',
      sortOrder: 'asc',
    });
  });

  it('เลือกระดับลูกค้าแล้วกดหน้าถัดไปทันที — ตัวกรองระดับต้องไม่หาย', () => {
    const { result } = setup('/customers?zone=shop');

    act(() => {
      result.current.q.setFilter('tier', 'GOLD');
      result.current.q.setPage(2);
    });

    expect(paramsOf(result.current.location.search)).toEqual({
      zone: 'shop',
      tier: 'GOLD',
      page: '2',
    });
  });

  it('ตัวเขียนอื่นแก้ URL ระหว่างทาง (เช่น ?zone= ของ layout) — การเขียนครั้งถัดไปต้องตั้งต้นจากค่าใหม่', () => {
    const { result } = setup('/customers?zone=shop&tier=GOLD');

    act(() => {
      result.current.q.setSort({ key: 'name', direction: 'desc' });
    });
    act(() => {
      result.current.q.setFilter('tier', '');
    });

    expect(paramsOf(result.current.location.search)).toEqual({
      zone: 'shop',
      sortBy: 'name',
      sortDirection: 'desc',
    });
  });
});
