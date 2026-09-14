import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CustomerDetailPage from '@/pages/CustomerDetailPage';
import { detail } from './fixtures';

/**
 * harness ลอกจาก pages/CustomersPage/__tests__/CustomersPage.test.tsx
 * 🔴 hook ของ vitest ห้าม return ค่า — คร่อมปีกกาเสมอ
 * 🔴 GET ที่ไม่ได้ลงทะเบียนต้องโยน error พร้อม URL — ถ้าคอมโพเนนต์ในหน้าเรียก endpoint ใหม่
 *    ให้เพิ่ม URL นั้นใน RESPONSES ด้วยรูปข้อมูลที่คอมโพเนนต์นั้นอ่าน (ดูจากไฟล์คอมโพเนนต์)
 */
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  role: 'OWNER',
  detail: null as unknown,
}));

vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.del },
  getErrorMessage: () => 'ผิดพลาด',
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'admin', role: mocks.role } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const RESPONSES: Record<string, unknown> = {
  '/customers/c1/risk-flag': { hasRisk: false, riskLevel: 'NONE', overdueContracts: [] },
  '/customers/c1/credit-check': [],
  '/customers/c1/tier': { tier: 'GOOD' },
  '/loyalty/c1/points': { balance: 120, lifetimeEarned: 140, lifetimeRedeemed: 20, referralCount: 0 },
  '/loyalty/c1/history?limit=20': { data: [] },
  '/loyalty/referral-stats/c1': { totalReferrals: 0, referralsWithContract: 0, totalPointsFromReferrals: 0, referrals: [] },
  '/audit/logs?entity=customers&entityId=c1&limit=20': { data: [] },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/customers/c1']}>
        <Routes>
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.role = 'OWNER';
  mocks.detail = detail();
  mocks.get.mockReset();
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/customers/c1') return { data: mocks.detail };
    if (url in RESPONSES) return { data: RESPONSES[url] };
    throw new Error(`unexpected GET ${url}`);
  });
});

describe('CustomerDetailPage', () => {
  it('แสดงชื่อลูกค้า และแท็บสัญญาแสดงเลขสัญญา', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'สมชาย ใจดี' })).toBeInTheDocument();
    // Radix TabsTrigger เปลี่ยนแท็บผ่าน onMouseDown/onFocus ไม่ใช่ onClick — fireEvent.click เฉย ๆ
    // ไม่ทำให้แท็บสลับใน jsdom (ยืนยันจาก node_modules/@radix-ui/react-tabs) ใช้ mouseDown แทน
    fireEvent.mouseDown(screen.getByRole('tab', { name: /สัญญา/ }));
    expect(await screen.findByText('CT-2569-0042')).toBeInTheDocument();
  });

  it('OWNER เห็นปุ่มแก้ไขข้อมูล และเปิดฟอร์มพร้อมชื่อเดิม', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'แก้ไขข้อมูล' }));
    const dialog = await screen.findByRole('dialog', { name: 'แก้ไขข้อมูลลูกค้า' });
    await waitFor(() => expect(dialog.querySelector('input[value="สมชาย ใจดี"]')).not.toBeNull());
  });

  it('SALES ไม่เห็นปุ่มแก้ไขข้อมูล', async () => {
    mocks.role = 'SALES';
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'สมชาย ใจดี' });
    expect(screen.queryByRole('button', { name: 'แก้ไขข้อมูล' })).toBeNull();
  });
});
