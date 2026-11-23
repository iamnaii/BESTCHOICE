import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import Overview from './OverviewPage';
const mock = vi.hoisted(() => ({ get: vi.fn(), fail: false }));
vi.mock('@/lib/api', () => ({
  default: { get: mock.get },
  getErrorMessage: () => 'โหลดไม่สำเร็จ',
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'OWNER' } }) }));
vi.mock('@/components/ui/animated-counter', () => ({
  default: ({ value }: { value: number }) => <span>{value}</span>,
}));
function Location() {
  const l = useLocation();
  const n = useNavigate();
  return (
    <>
      <output data-testid="location">{l.search}</output>
      <button onClick={() => n(-1)}>ย้อนกลับทดสอบ</button>
      <button onClick={() => n(1)}>ไปข้างหน้าทดสอบ</button>
    </>
  );
}
beforeEach(() => {
  mock.fail = false;
  mock.get.mockImplementation(async (url: string, { params = {} }: any = {}) => {
    if (mock.fail) throw Error('offline');
    const device = params.inventoryScope === 'devices',
      accessory = params.inventoryScope === 'accessories';
    const count = device ? 40 : accessory ? 608 : 648;
    if (url === '/products/stock')
      return {
        data: {
          products: [],
          summary: [
            {
              branch: { id: 'b', name: 'สาขาทดสอบ' },
              total: count + 3,
              inStock: count,
              totalValue: device ? 707187 : 29755,
            },
          ],
        },
      };
    if (url === '/products/warranty/expiring') return { data: [] };
    const current = {
      count: device ? 164 : accessory ? 369 : 533,
      nativeCount: 0,
      importedCount: device ? 164 : accessory ? 369 : 533,
      giftCount: device ? 0 : 369,
      unknownCount: 0,
      revenue: accessory ? '0' : '3275269',
    };
    return {
      data: {
        stockAging: [],
        valueByStatus: [],
        byCategory: [],
        byBrand: [],
        byColor: [],
        byStorage: [],
        stockMovement: [],
        topSellers: [],
        slowMovers: [],
        marginOverview: null,
        stockTurnover: {
          currentStock: count,
          avgDaysInStock: 12,
          soldThisMonth: current.count,
          soldLastMonth: 299,
        },
        actionRequired: {
          inspection: 0,
          qcPending: 3,
          photoPending: 0,
          pendingTransfers: 0,
          repossessed: 0,
          agingOver90: 2,
        },
        salesAnalytics: {
          current,
          previous: current,
          nativeIncluded: true,
          importedIncluded: true,
          unattributedCount: 0,
          asOf: '2026-11-22T10:00:00Z',
          month: '2026-11',
          startDate: '2026-10-31T17:00:00Z',
        },
      },
    };
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function show(path = '/stock?zone=shop') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Location />
        <Routes>
          <Route path="/stock" element={<Overview />} />
          <Route path="/stock/products" element={<p>รายการปลายทาง</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it('opens devices, switches all metrics and preserves back navigation', async () => {
  show();
  expect(await screen.findByText('164')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'เครื่อง' })).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(screen.getByRole('radio', { name: 'อุปกรณ์เสริม' }));
  expect(await screen.findByText('369')).toBeInTheDocument();
  expect(mock.get).toHaveBeenCalledWith(
    '/products/stock/dashboard',
    expect.objectContaining({ params: expect.objectContaining({ inventoryScope: 'accessories' }) }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'ย้อนกลับทดสอบ' }));
  expect(await screen.findByText('164')).toBeInTheDocument();
});
it('opens only over90 ready devices and keeps branch and zone', async () => {
  show('/stock?zone=shop&branchId=b');
  await screen.findByText('164');
  fireEvent.click(screen.getByRole('button', { name: /ค้าง.*90/ }));
  const url = screen.getByTestId('location').textContent!;
  for (const [key, value] of Object.entries({
    inventoryScope: 'devices',
    view: 'ready',
    aging: 'over90',
    branchId: 'b',
    zone: 'shop',
  }))
    expect(new URLSearchParams(url).get(key)).toBe(value);
});
it('opens QC in all-status view and shows imported sales provenance', async () => {
  show();
  await screen.findByText('164');
  fireEvent.click(screen.getByRole('button', { name: /ดูที่มาของยอด/ }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Tooltify');
  expect(screen.getByRole('dialog')).toHaveTextContent('3,275,269');
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: /รอตรวจรับ/ }));
  expect(screen.getByTestId('location')).toHaveTextContent('view=all');
  expect(screen.getByTestId('location')).toHaveTextContent('status=QC_PENDING');
});
it('shows an error and retry instead of zero sales when loading fails', async () => {
  mock.fail = true;
  show();
  expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
  expect(screen.queryByText('164')).toBeNull();
  mock.fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่เฉพาะสถิติคลัง' }));
  expect(await screen.findByText('164')).toBeInTheDocument();
});

it('keeps authorized inventory usable when only warranty is denied', async () => {
  const normal = mock.get.getMockImplementation()!;
  mock.get.mockImplementation((url: string, options: any) =>
    url === '/products/warranty/expiring' ? Promise.reject(Error('403')) : normal(url, options),
  );
  show();
  expect(await screen.findByText('164')).toBeInTheDocument();
  expect(
    await screen.findByText('โหลดข้อมูลประกันไม่สำเร็จ หรือไม่มีสิทธิ์ดู'),
  ).toBeInTheDocument();
  expect(screen.queryByText('ไม่พบงานค้างในหมวดและสาขาที่เลือก')).toBeNull();
  mock.get.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่เฉพาะข้อมูลประกัน' }));
  await waitFor(() => expect(mock.get).toHaveBeenCalled());
  expect(mock.get.mock.calls.every(([url]) => url === '/products/warranty/expiring')).toBe(true);
});

it('ignores an older delayed scope response and preserves Forward', async () => {
  const normal = mock.get.getMockImplementation()!;
  const deferred: Array<() => void> = [];
  mock.get.mockImplementation((url: string, options: any) =>
    options?.params?.inventoryScope === 'accessories'
      ? new Promise((resolve) => deferred.push(async () => resolve(await normal(url, options))))
      : normal(url, options),
  );
  show();
  await screen.findByText('164');
  fireEvent.click(screen.getByRole('radio', { name: 'อุปกรณ์เสริม' }));
  await waitFor(() => expect(deferred.length).toBe(3));
  fireEvent.click(screen.getByRole('radio', { name: 'ทั้งหมด' }));
  await screen.findByText('533');
  await act(async () => {
    deferred.forEach((done) => done());
  });
  expect(screen.getByText('533')).toBeInTheDocument();
  expect(screen.queryByText('369')).toBeNull();
  mock.get.mockImplementation(normal);
  fireEvent.click(screen.getByRole('button', { name: 'ย้อนกลับทดสอบ' }));
  await screen.findByText('369');
  fireEvent.click(screen.getByRole('button', { name: 'ไปข้างหน้าทดสอบ' }));
  await screen.findByText('533');
});
it('opens the general list in ready view', async () => {
  show('/stock?zone=finance');
  await screen.findByText('164');
  fireEvent.click(screen.getByRole('button', { name: 'รายการสินค้า' }));
  expect(screen.getByTestId('location')).toHaveTextContent('view=ready');
  expect(screen.getByTestId('location')).toHaveTextContent('zone=finance');
});
