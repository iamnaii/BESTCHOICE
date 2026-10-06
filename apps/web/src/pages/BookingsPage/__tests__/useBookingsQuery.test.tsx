import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBookingsQuery } from '../hooks/useBookingsQuery';

const mocks = vi.hoisted(() => ({ get: vi.fn(), role: 'OWNER' as string }));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get },
  getErrorMessage: () => 'โหลดไม่สำเร็จ',
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: mocks.role, branchId: 'br-1' } }),
}));

function setup(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(() => ({ q: useBookingsQuery(), location: useLocation() }), { wrapper });
}
const paramsOf = (search: string) => Object.fromEntries(new URLSearchParams(search));

describe('useBookingsQuery — URL คือแหล่งความจริงของตัวกรอง', () => {
  beforeEach(() => {
    mocks.role = 'OWNER';
    mocks.get.mockReset();
    mocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/bookings/summary'))
        return {
          data: {
            total: 8,
            open: 5,
            pendingDeposit: 1,
            paid: 4,
            paidDepositHeld: '33900.00',
            expiringWithin3Days: 3,
            closed: { converted: 1, canceled: 1, expired: 1, total: 3 },
            forfeitedThisMonth: '3000.00',
          },
        };
      if (path === '/branches')
        return {
          data: [
            { id: 'br-1', name: 'ลาดพร้าว' },
            { id: 'br-2', name: 'รามอินทรา' },
          ],
        };
      return { data: { data: [], total: 0, page: 1, limit: 50 } };
    });
  });

  it('ไม่มีคีย์ในกริ้ง → มุมมอง "ที่ยังเปิดอยู่" ส่ง open=1 เรียง expireDate asc', () => {
    const { result } = setup('/bookings?zone=shop');
    expect(result.current.q.view).toBe('open');
    expect(result.current.q.activeKpiKey).toBe('open');
    expect(result.current.q.buildParams()).toMatchObject({
      open: '1',
      sort: 'expireDate',
      order: 'asc',
      page: '1',
      limit: '50',
    });
    expect(result.current.q.buildParams().status).toBeUndefined();
  });

  it('การ์ด "มัดจำแล้ว" → status=PAID ลบ open/expiring/all/page และคง ?zone=', () => {
    const { result } = setup('/bookings?zone=shop&page=3&expiring=3');
    act(() => result.current.q.setFilters({ status: 'PAID', expiring: '', all: '' }));
    expect(paramsOf(result.current.location.search)).toEqual({ zone: 'shop', status: 'PAID' });
    expect(result.current.q.view).toBe('status');
    expect(result.current.q.activeKpiKey).toBe('paid');
    expect(result.current.q.buildParams()).toMatchObject({
      status: 'PAID',
      sort: 'createdAt',
      order: 'desc',
    });
  });

  it('กดการ์ดสองใบติดกันก่อน render → ใบหลังชนะ ตัวกรองไม่ทับกัน', () => {
    const { result } = setup('/bookings?zone=shop');
    act(() => {
      result.current.q.setFilters({ status: 'PAID', expiring: '', all: '' });
      result.current.q.setFilters({ expiring: '3', status: '', all: '' });
    });
    expect(paramsOf(result.current.location.search)).toEqual({ zone: 'shop', expiring: '3' });
    expect(result.current.q.activeKpiKey).toBe('expiring');
  });

  it('สถานะ "ทั้งหมด" ในดรอปดาวน์ = all=1 (ไม่ส่ง open)', () => {
    const { result } = setup('/bookings');
    act(() => result.current.q.setFilters({ all: '1', status: '', expiring: '' }));
    expect(result.current.q.view).toBe('all');
    expect(result.current.q.activeKpiKey).toBe('');
    const params = result.current.q.buildParams();
    expect(params.open).toBeUndefined();
    expect(params.status).toBeUndefined();
  });

  it('เรียงจากหัวตาราง เขียน sortBy/sortDirection และส่งเป็น sort/order', () => {
    const { result } = setup('/bookings');
    act(() => result.current.q.setSort({ key: 'createdAt', direction: 'asc' }));
    expect(paramsOf(result.current.location.search)).toEqual({
      sortBy: 'createdAt',
      sortDirection: 'asc',
    });
    expect(result.current.q.buildParams()).toMatchObject({ sort: 'createdAt', order: 'asc' });
  });

  it('ค้นหา debounce แล้วเขียน ?q= ลง URL ลบ page และส่งเป็น search', async () => {
    const { result } = setup('/bookings?page=2');
    act(() => result.current.q.setSearch('081-234'));
    await waitFor(() => expect(result.current.q.debouncedSearch).toBe('081-234'));
    await waitFor(() => expect(paramsOf(result.current.location.search)).toEqual({ q: '081-234' }));
    expect(result.current.q.buildParams()).toMatchObject({ search: '081-234', page: '1' });
  });

  it('มีคำค้นอยู่ แล้ว setPage(2) → คำขอรายการใช้ page=2 จริง', async () => {
    const { result } = setup('/bookings');
    act(() => result.current.q.setSearch('081'));
    await waitFor(() => expect(paramsOf(result.current.location.search)).toEqual({ q: '081' }));
    act(() => result.current.q.setPage(2));
    expect(paramsOf(result.current.location.search)).toEqual({ q: '081', page: '2' });
    expect(result.current.q.buildParams().page).toBe('2');
  });

  it('?expiring=3 → มุมมอง expiring ไม่ส่ง open เรียง expireDate asc', () => {
    const { result } = setup('/bookings?expiring=3');
    expect(result.current.q.view).toBe('expiring');
    const params = result.current.q.buildParams();
    expect(params).toMatchObject({ expiring: '3', sort: 'expireDate', order: 'asc' });
    expect(params.open).toBeUndefined();
  });

  it.each(['0', '00', '31', 'abc'])('?expiring=%s → ไม่ใช่มุมมอง expiring', (v) => {
    const { result } = setup(`/bookings?expiring=${v}`);
    expect(result.current.q.view).toBe('open');
    expect(result.current.q.buildParams().expiring).toBeUndefined();
  });

  it('?status=CLOSED → ส่ง status=CLOSED ไม่ส่ง open เรียง createdAt desc', () => {
    const { result } = setup('/bookings?status=CLOSED');
    const params = result.current.q.buildParams();
    expect(params).toMatchObject({ status: 'CLOSED', sort: 'createdAt', order: 'desc' });
    expect(params.open).toBeUndefined();
  });

  it('SALES ไม่เห็นตัวกรองสาขา และ branchId ในลิงก์ถูกเพิกเฉย', () => {
    mocks.role = 'SALES';
    const { result } = setup('/bookings?branchId=br-2');
    expect(result.current.q.canFilterBranch).toBe(false);
    expect(result.current.q.branchId).toBe('');
    expect(result.current.q.buildParams().branchId).toBeUndefined();
  });

  it('โหลดสรุปด้วยสาขา/ช่วงวันที่เดียวกับรายการ', async () => {
    const { result } = setup('/bookings?branchId=br-2&from=2026-10-01&to=2026-10-05');
    await waitFor(() => expect(result.current.q.summary?.total).toBe(8));
    const summaryCall = mocks.get.mock.calls.find(([path]) =>
      String(path).startsWith('/bookings/summary'),
    )?.[0] as string;
    expect(paramsOf(summaryCall.split('?')[1])).toEqual({
      branchId: 'br-2',
      from: '2026-10-01',
      to: '2026-10-05',
    });
    expect(result.current.q.hasActiveFilters).toBe(true);
    act(() => result.current.q.clearFilters());
    expect(result.current.location.search).toBe('');
  });

  it.each([
    ['from=2026-1-1', 'from'],
    ['to=05-10-2026', 'to'],
    ['from=abc&to=2026-10-0', 'from'],
    ['from=2026-10-01x', 'from'],
  ])('?%s → วันที่ผิดรูปแบบถือว่าไม่มี: ไม่ส่งไป API และไม่นับเป็นตัวกรอง', async (query) => {
    const { result } = setup(`/bookings?${query}`);
    await waitFor(() => expect(result.current.q.summary?.total).toBe(8));
    expect(result.current.q.from).toBe('');
    expect(result.current.q.to).toBe('');
    expect(result.current.q.buildParams().from).toBeUndefined();
    expect(result.current.q.buildParams().to).toBeUndefined();
    expect(result.current.q.hasActiveFilters).toBe(false);
    const summaryCall = mocks.get.mock.calls.find(([path]) =>
      String(path).startsWith('/bookings/summary'),
    )?.[0] as string;
    expect(summaryCall.split('?')[1]).toBe('');
  });

  it('วันที่ถูกรูปแบบผ่านตามเดิม', () => {
    const { result } = setup('/bookings?from=2026-10-01&to=2026-10-05');
    expect(result.current.q.from).toBe('2026-10-01');
    expect(result.current.q.to).toBe('2026-10-05');
  });

  it.each(['CONVERTED', 'CANCELED', 'EXPIRED'])(
    '?status=%s → มุมมอง status ส่งสถานะนั้นตรง ๆ ไป API (ไม่ถูกแปลงเป็น CLOSED)',
    (status) => {
      const { result } = setup(`/bookings?status=${status}`);
      expect(result.current.q.view).toBe('status');
      expect(result.current.q.buildParams().status).toBe(status);
    },
  );

  it('เปลี่ยนตัวกรอง: ตารางและการ์ดยังเห็นข้อมูลเดิมระหว่างโหลดชุดใหม่ (keepPreviousData) ไม่กลับเป็นโครงรอ', async () => {
    let releaseList: (v: unknown) => void = () => {};
    let releaseSummary: (v: unknown) => void = () => {};
    const row = { id: 'bk-1' };
    const listFor = (params: URLSearchParams) =>
      params.get('status') === 'PAID'
        ? new Promise((resolve) => (releaseList = resolve))
        : Promise.resolve({ data: { data: [row], total: 1, page: 1, limit: 50 } });
    const base = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path: string) => {
      if (path.startsWith('/bookings?')) return listFor(new URLSearchParams(path.split('?')[1]));
      if (path.startsWith('/bookings/summary') && path.includes('from=2026-10-01'))
        return new Promise((resolve) => (releaseSummary = resolve));
      return base(path);
    });
    const { result } = setup('/bookings');
    await waitFor(() => expect(result.current.q.listResult?.total).toBe(1));
    await waitFor(() => expect(result.current.q.summary?.total).toBe(8));

    act(() => result.current.q.setFilters({ status: 'PAID', expiring: '', all: '' }));
    // คำขอใหม่ยังไม่กลับ — ข้อมูลเดิมต้องอยู่ และไม่ขึ้นสถานะ "กำลังโหลด" แบบหน้าว่าง
    expect(result.current.q.listResult?.total).toBe(1);
    expect(result.current.q.isLoading).toBe(false);
    releaseList({ data: { data: [], total: 0, page: 1, limit: 50 } });
    await waitFor(() => expect(result.current.q.listResult?.total).toBe(0));

    act(() => result.current.q.setFilters({ from: '2026-10-01' }));
    expect(result.current.q.summary?.total).toBe(8);
    expect(result.current.q.summaryLoading).toBe(false);
    releaseSummary({ data: { ...(await base('/bookings/summary')).data, total: 2 } });
    await waitFor(() => expect(result.current.q.summary?.total).toBe(2));
  });
});
