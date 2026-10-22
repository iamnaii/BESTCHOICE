import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import api from '@/lib/api';
import ShopHomePage from '../index';
import type { ShopHomeResponse } from '../types';

/**
 * หน้าหลักหน้าร้านตาม mockup ที่เจ้าของเคาะ (canvas AeXB44haXjLfvXYm5kjUeR) —
 * มุมมองเจ้าของ (เห็นต้นทุน/กำไร) และพนักงานขาย (server ตัดต้นทุนออกแล้ว)
 */
const state = vi.hoisted(() => ({ role: 'OWNER' }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', name: 'ผู้ใช้ทดสอบ', role: state.role, branchName: 'สำนักงานใหญ่' } }),
}));
vi.mock('@/lib/api', () => ({ default: { get: vi.fn() } }));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({ cacheTtlDashboard: 60 }) }));
vi.mock('@/components/CommandPalette', () => ({ useCommandPalette: () => ({ open: vi.fn() }) }));
vi.mock('@/pages/DashboardPage/components/MyTodayTasksCard', () => ({
  default: () => <section aria-label="my-today-tasks" />,
}));
vi.mock('@/pages/DashboardPage/components/HomeActionsGrid', () => ({
  default: () => <section aria-label="home-actions" />,
}));
vi.mock('@/pages/DashboardPage/components/DashboardMySales', () => ({
  default: () => <section aria-label="my-sales" />,
}));

const full = (): ShopHomeResponse => ({
  generatedAt: '2026-10-22T01:12:00.000Z',
  branch: { id: null, name: 'ทุกสาขา' },
  today: {
    sales: { count: 6, netAmount: 48900, cash: 3, installment: 2, externalFinance: 1 },
    cashDrawer: { balance: 12450, closedToday: false, lastClosedAt: '2026-10-21T14:05:00.000Z' },
    bookingsExpiringToday: { count: 2, depositTotal: 4000, reservedUnits: 2 },
    afterSales: { waitingPickup: 3, overdue: 1 },
  },
  watch: [
    { key: 'LOW_STOCK', count: 4, severity: 'urgent', detail: 'ฟิล์ม 15 Pro · เคสใส 14', costValue: null },
    { key: 'AGING_90', count: 7, severity: 'urgent', detail: null, costValue: 61200 },
    { key: 'QC_PHOTO', count: 5, severity: 'wait', detail: 'รอ QC 2 · รอถ่ายรูป 3', costValue: null },
    { key: 'PO_APPROVAL', count: 1, severity: 'info', detail: 'PO-2610-014', costValue: null },
  ],
  monthly: [
    { month: '2026-05', sales: 312000, cost: 221000, grossProfit: 91000 },
    { month: '2026-06', sales: 298000, cost: 214000, grossProfit: 84000 },
    { month: '2026-07', sales: 355000, cost: 248000, grossProfit: 107000 },
    { month: '2026-08', sales: 341000, cost: 236000, grossProfit: 105000 },
    { month: '2026-09', sales: 372000, cost: 254000, grossProfit: 118000 },
    { month: '2026-10', sales: 384400, cost: 266000, grossProfit: 118400 },
  ],
  thisMonth: { sales: 384400, salesMomPct: 3, cost: 266000, grossProfit: 118400, grossMarginPct: 31, grossProfitMomPct: 0 },
  topSellers30d: {
    byModel: [{ name: 'Apple iPhone 15', count: 14 }, { name: 'Samsung A16', count: 6 }],
    byCategory: [{ name: 'PHONE_NEW', count: 20 }, { name: 'ACCESSORY', count: 9 }],
  },
  slowMovers: [
    { name: 'Apple iPhone 14 Plus', days: 164, costPrice: 18900 },
    { name: 'OPPO A58', days: 88, costPrice: 4900 },
  ],
  stockAging: [
    { label: '0-30 วัน', count: 21 },
    { label: '31-60 วัน', count: 6 },
    { label: '61-90 วัน', count: 3 },
    { label: '90+ วัน', count: 7 },
  ],
});

/** สิ่งที่ SALES ได้รับจริงหลัง redactShopHome + ตัด PO_APPROVAL ที่ controller */
const redacted = (): ShopHomeResponse => {
  const f = full();
  return {
    ...f,
    watch: f.watch.filter((w) => w.key !== 'PO_APPROVAL').map((w) => ({ ...w, costValue: null })),
    monthly: f.monthly.map((m) => ({ ...m, cost: null, grossProfit: null })),
    thisMonth: { sales: 384400, salesMomPct: 3, cost: null, grossProfit: null, grossMarginPct: null, grossProfitMomPct: null },
    slowMovers: f.slowMovers.map(({ name, days }) => ({ name, days })),
  };
};

function renderPage(data: ShopHomeResponse) {
  vi.mocked(api.get).mockResolvedValue({ data });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ShopHomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  state.role = 'OWNER';
});

describe('หน้าหลักหน้าร้าน', () => {
  it('OWNER: เห็นยอดขายวันนี้ กำไรขั้นต้น ทุนจม และหัวกราฟแบบเต็ม', async () => {
    renderPage(full());
    expect(await screen.findByRole('heading', { name: 'หน้าหลักหน้าร้าน' })).toBeInTheDocument();
    expect(screen.getByText('48,900')).toBeInTheDocument();
    expect(screen.getByText(/6 บิล · ขายสด 3 · ผ่อน 2 · ไฟแนนซ์นอก 1/)).toBeInTheDocument();
    expect(screen.getByText(/ยังไม่ปิดยอดวันนี้/)).toBeInTheDocument();
    expect(screen.getByText('ใบจองหมดอายุวันนี้')).toBeInTheDocument();
    expect(screen.getByText(/เกินกำหนดนัด 1 เคส/)).toBeInTheDocument();
    expect(screen.getByText(/ทุนจม 61,200 ฿/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ยอดขาย · ต้นทุน · กำไรขั้นต้น 6 เดือน' })).toBeInTheDocument();
    expect(screen.getByText('118,400')).toBeInTheDocument();
    expect(screen.getByText(/เทียบเดือนก่อนทั้งเดือน/)).toBeInTheDocument();
    expect(screen.getByText('Apple iPhone 15')).toBeInTheDocument();
    expect(screen.getByText(/ทุน 18,900/)).toBeInTheDocument();
    expect(screen.getByText(/ดูทั้งหมด 7 เครื่อง/)).toHaveAttribute('href', '/stock/products?sortBy=stockInDate&sortDirection=asc');
    expect(api.get).toHaveBeenCalledWith('/shop-home');
    expect(screen.queryByLabelText('home-actions')).toBeNull();
    expect(screen.queryByLabelText('my-today-tasks')).toBeNull();
    expect(screen.queryByLabelText('my-sales')).toBeNull();
    expect(screen.queryByText(/เริ่มใช้งานครั้งแรก/)).toBeNull();
  });

  it('SALES (response ถูกตัด): ไม่มีคำว่า "ทุน" ในหน้า หัวกราฟ "ยอดขาย 6 เดือน" และมีการ์ดงานของฉัน + ปุ่มเริ่มงาน', async () => {
    state.role = 'SALES';
    renderPage(redacted());
    expect(await screen.findByRole('heading', { name: 'ยอดขาย 6 เดือน' })).toBeInTheDocument();
    expect(screen.queryByText(/ทุน/)).toBeNull();
    expect(screen.getByText('384,400')).toBeInTheDocument();
    expect(screen.getByLabelText('my-today-tasks')).toBeInTheDocument();
    expect(screen.getByLabelText('home-actions')).toBeInTheDocument();
    // ของเดิมบนหน้าเริ่มงาน (StaffHome) ที่ SALES เคยเห็นทุกวัน ต้องไม่หายเมื่อหน้าหลักหน้าร้านมาแทน
    expect(screen.getByLabelText('my-sales')).toBeInTheDocument();
    expect(screen.getByText(/เริ่มใช้งานครั้งแรก/)).toBeInTheDocument();
    expect(screen.queryByText('ใบสั่งซื้อรออนุมัติ')).toBeNull();
    expect(screen.queryByRole('link', { name: 'รับของเข้า' })).toBeNull();
    // แถวสินค้าใกล้หมดเป็นข้อความธรรมดา ไม่ใช่ลิงก์ (SALES เปิด /stock/alerts ไม่ได้)
    expect(screen.getByText('สินค้าใกล้หมด').closest('a')).toBeNull();
  });

  it('OWNER: แถวสินค้าใกล้หมดเป็นลิงก์ไป /stock/alerts และปุ่มรับของเข้าไป /purchase-orders', async () => {
    renderPage(full());
    expect((await screen.findByText('สินค้าใกล้หมด')).closest('a')).toHaveAttribute('href', '/stock/alerts');
    expect(screen.getByRole('link', { name: 'รับของเข้า' })).toHaveAttribute('href', '/purchase-orders');
    expect(screen.getByRole('link', { name: 'ขายสินค้า' })).toHaveAttribute('href', '/pos');
  });

  it('ชิปทุกแถวของงานค้างมีคำกำกับ ด่วน/รอ/แจ้ง (ไม่สื่อด้วยสีอย่างเดียว)', async () => {
    renderPage(full());
    await screen.findByText('สินค้าใกล้หมด');
    expect(screen.getAllByText(/^(ด่วน|รอ|แจ้ง)$/)).toHaveLength(4);
  });

  it('watch ว่าง → "ไม่มีงานค้าง วันนี้ว่าง"', async () => {
    renderPage({ ...full(), watch: [] });
    expect(await screen.findByText('ไม่มีงานค้าง วันนี้ว่าง')).toBeInTheDocument();
  });

  it('monthly 3 เดือน → หน้าไม่พัง', async () => {
    const f = full();
    renderPage({ ...f, monthly: f.monthly.slice(3) });
    expect(await screen.findByRole('heading', { name: 'ยอดขาย · ต้นทุน · กำไรขั้นต้น 6 เดือน' })).toBeInTheDocument();
    expect(screen.getByText(/เทียบเดือนก่อนทั้งเดือน/)).toBeInTheDocument();
  });

  it('monthly เดือนเดียว (MoM เป็น null) → ซ่อนช่องเทียบเดือนก่อน', async () => {
    const one = full();
    renderPage({ ...one, monthly: one.monthly.slice(5), thisMonth: { ...one.thisMonth, salesMomPct: null, grossProfitMomPct: null } });
    expect(await screen.findByRole('heading', { name: 'ยอดขาย · ต้นทุน · กำไรขั้นต้น 6 เดือน' })).toBeInTheDocument();
    expect(screen.queryByText(/เทียบเดือนก่อนทั้งเดือน/)).toBeNull();
  });

  it('สลับแท็บ "ตามหมวด" แสดงชื่อหมวดภาษาไทย', async () => {
    const { getByRole } = renderPage(full());
    await screen.findByText('Apple iPhone 15');
    getByRole('button', { name: 'ตามหมวด' }).click();
    expect(await screen.findByText('มือถือใหม่')).toBeInTheDocument();
  });
});
