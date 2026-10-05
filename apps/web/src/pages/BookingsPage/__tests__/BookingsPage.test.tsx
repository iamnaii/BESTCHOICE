import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import BookingsPage from '../index';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  role: 'SALES' as string,
  total: 1,
}));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post, patch: vi.fn(), delete: vi.fn() },
  getErrorMessage: (e: Error) => e.message,
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: mocks.role, branchId: 'br-1' } }),
}));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const booking = {
  id: 'bk-1',
  bookingNumber: 'BK-20261005-0002',
  status: 'PAID',
  depositAmount: '5000',
  totalAmount: '42900',
  expireDate: '2099-10-11T17:00:00.000Z',
  depositPaidAt: '2026-10-05T03:55:00Z',
  depositMethod: 'CASH',
  createdAt: '2026-10-05T03:42:00Z',
  customer: { id: 'c1', name: 'สมชาย ใจดี', phone: '0812345678' },
  branch: { id: 'br-1', name: 'ลาดพร้าว', shopCashAccountCode: 'S11-1101' },
  createdBy: { id: 'u1', name: 'น้ำ' },
  items: [
    {
      id: 'i1',
      productId: 'p1',
      description: 'iPhone 16 Pro 256GB',
      quantity: 1,
      unitPrice: '42900',
      amount: '42900',
      product: { id: 'p1', name: 'iPhone 16 Pro', status: 'IN_STOCK', branchId: 'br-1' },
    },
  ],
  events: [],
};
const summary = () => ({
  total: mocks.total,
  open: mocks.total,
  pendingDeposit: 0,
  paid: mocks.total,
  paidDepositHeld: '5000.00',
  expiringWithin3Days: 0,
  closed: { converted: 0, canceled: 0, expired: 0, total: 0 },
  forfeitedThisMonth: '0.00',
});

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="loc">{loc.search}</output>;
}
function renderPage(url = '/bookings?zone=shop') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <MemoryRouter initialEntries={[url]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route
            path="/bookings"
            element={
              <>
                <LocationProbe />
                <BookingsPage />
              </>
            }
          />
          <Route path="/sales" element={<p>หน้าขาย</p>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  HTMLElement.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'SALES';
  mocks.total = 1;
  mocks.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/bookings/summary')) return { data: summary() };
    if (path === '/bookings/bk-1') return { data: booking };
    if (path.startsWith('/bookings?'))
      return {
        data: { data: mocks.total ? [booking] : [], total: mocks.total, page: 1, limit: 50 },
      };
    if (path === '/branches') return { data: [{ id: 'br-1', name: 'ลาดพร้าว' }] };
    return { data: [] };
  });
  mocks.post.mockResolvedValue({ data: {} });
});

describe('BookingsPage', () => {
  it('สรุปยังไม่โหลดเสร็จ → แสดงโครงรอ ไม่มีการ์ด KPI และไม่มีหน้าว่าง', async () => {
    const base = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path: string) =>
      path.startsWith('/bookings/summary') ? new Promise(() => {}) : base(path),
    );
    renderPage();
    expect(await screen.findByRole('status', { name: 'กำลังโหลดข้อมูลใบจอง' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /การจอง \/ มัดจำ/ })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'สรุปใบจอง' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'ยังไม่มีใบจอง' })).toBeNull();
  });

  it('หัว · การ์ด KPI · ตาราง และกดการ์ดเปลี่ยน URL', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /การจอง \/ มัดจำ/ })).toBeInTheDocument();
    expect(await screen.findByText('BK-20261005-0002')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /มัดจำแล้ว · รอรับเครื่อง/ }));
    expect(screen.getByTestId('loc')).toHaveTextContent('status=PAID');
    expect(screen.getByTestId('loc')).toHaveTextContent('zone=shop');
  });

  it('กดแถวเปิดแผงรายละเอียดและเขียน ?bookingId= · ปิดแล้วลบคีย์', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('สมชาย ใจดี'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('loc')).toHaveTextContent('bookingId=bk-1');
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.getByTestId('loc')).not.toHaveTextContent('bookingId'));
  });

  it('ลิงก์ ?bookingId= จากใบเสร็จเปิดแผงทันที', async () => {
    renderPage('/bookings?bookingId=bk-1');
    const sheet = await screen.findByRole('dialog');
    await waitFor(() => expect(sheet).toHaveTextContent('BK-20261005-0002'));
  });

  it('ปุ่มสร้างใบจองเปิดฟอร์ม (SALES) · บทบาทอ่านอย่างเดียวไม่มีปุ่ม', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /สร้างใบจอง/ }));
    expect(await screen.findByRole('heading', { name: 'สร้างใบจอง' })).toBeInTheDocument();
  });

  it('ACCOUNTANT: ไม่มีปุ่มสร้าง และเมนูแถวไม่มีรับมัดจำ/ยกเลิก', async () => {
    mocks.role = 'ACCOUNTANT';
    renderPage();
    await screen.findByText('BK-20261005-0002');
    expect(screen.queryByRole('button', { name: /สร้างใบจอง/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /การกระทำ BK-20261005-0002/ }));
    expect(await screen.findByRole('menuitem', { name: 'เปิด' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /ยกเลิกใบจอง/ })).not.toBeInTheDocument();
  });

  it('ยังไม่มีใบจองเลยทั้งระบบ → หน้าว่าง 3 ขั้น ไม่มีการ์ด KPI/ตัวกรอง', async () => {
    mocks.total = 0;
    renderPage();
    expect(await screen.findByRole('heading', { name: 'ยังไม่มีใบจอง' })).toBeInTheDocument();
    expect(screen.getByText(/รับส่วนต่างและขาย/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ที่ยังเปิดอยู่/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ค้นหาใบจอง')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'สร้างใบจองแรก' }));
    expect(await screen.findByRole('heading', { name: 'สร้างใบจอง' })).toBeInTheDocument();
  });

  it('ยกเลิกจากเมนูแถว → กล่องยืนยัน → POST cancel พร้อมเหตุผล', async () => {
    renderPage();
    await screen.findByText('BK-20261005-0002');
    await userEvent.click(screen.getByRole('button', { name: /การกระทำ BK-20261005-0002/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /ยกเลิกใบจอง/ }));
    const confirm = await screen.findByRole('dialog', { name: /ยกเลิกใบจอง/ });
    await userEvent.click(within(confirm).getByRole('button', { name: 'ไม่ผ่านเครดิต' }));
    await userEvent.click(
      within(confirm).getByRole('button', { name: /ยืนยันยกเลิกและคืนมัดจำ 5,000/ }),
    );
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/bookings/bk-1/cancel', {
        cancelReason: 'ไม่ผ่านเครดิต',
      }),
    );
  });
});
