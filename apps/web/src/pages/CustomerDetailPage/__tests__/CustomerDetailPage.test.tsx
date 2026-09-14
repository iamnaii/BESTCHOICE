import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CustomerDetailPage from '@/pages/CustomerDetailPage';
import { formatNationalId, maskNationalId } from '@/utils/mask.util';
import { detail, emptyPurchase, progress } from './fixtures';

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

  // R5: CreditTab/LoyaltyTab อยู่ใน Radix TabsContent ที่ unmount แผงไม่ active — ถ้า mutation
  // (analyzeCreditMutation) อยู่ในคอมโพเนนต์นั้น สลับแท็บออกแล้วกลับมาจะได้ instance ใหม่ที่
  // isPending=false ทั้งที่ POST เดิมยังค้างอยู่ ⇒ ปุ่มกลับมากดซ้ำได้ ยิง POST ซ้ำ แก้ด้วย
  // useIsMutating(mutationKey เดียวกัน) ซึ่งอ่านจาก mutation cache กลางที่ไม่ได้ unmount ไปด้วย
  it('ปุ่ม AI วิเคราะห์ยังปิดอยู่ ถ้าสลับแท็บออกแล้วกลับมาระหว่าง request ค้าง (R5)', async () => {
    const pendingCreditCheck = {
      id: 'cc1', status: 'PENDING', bankName: null, statementFiles: [], statementMonths: 3,
      aiScore: null, aiSummary: null, aiRecommendation: null, aiAnalysis: null, reviewNotes: null,
      checkedBy: null, contract: null, createdAt: '2026-09-01T00:00:00.000Z',
    };
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/customers/c1') return { data: mocks.detail };
      if (url === '/customers/c1/credit-check') return { data: [pendingCreditCheck] };
      if (url in RESPONSES) return { data: RESPONSES[url] };
      throw new Error(`unexpected GET ${url}`);
    });
    mocks.post.mockReset();
    mocks.post.mockImplementation(async (url: string) => {
      if (url === '/customers/c1/credit-check/cc1/analyze') {
        return new Promise(() => {}); // ค้างตลอดอายุเทสต์ — จำลอง request ที่ยังไม่ตอบกลับ
      }
      throw new Error(`unexpected POST ${url}`);
    });

    renderPage();
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /เครดิต/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'AI วิเคราะห์' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'กำลังวิเคราะห์...' })).toBeDisabled());

    // สลับไปแท็บอื่นแล้วกลับมา — CreditTab unmount/remount ระหว่างที่ analyze ยังค้างอยู่
    fireEvent.mouseDown(screen.getByRole('tab', { name: /สัญญา/ }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: /เครดิต/ }));

    expect(await screen.findByRole('button', { name: 'กำลังวิเคราะห์...' })).toBeDisabled();
  });
});

function Location() {
  const location = useLocation();
  return <output aria-label="current location">{location.pathname}{location.search}</output>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/customers/:id" element={<><CustomerDetailPage /><Location /></>} />
          <Route path="*" element={<Location />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('หัวหน้า + ตัวเลข + แถบเตือน + คอลัมน์ขวา', () => {
  it('ลูกค้าผ่อนค้างชำระ: ป้ายระดับ + แท็ก + ช่องคงค้าง + แถบเตือนพาไปรับชำระ', async () => {
    mocks.detail = detail({
      tags: [{ tag: 'LOYAL' }],
      purchase: { ...emptyPurchase, installmentTotal: 1 },
      installmentBalance: { outstanding: 25200, nextDueDate: '2026-10-05T00:00:00.000Z', nextAmountDue: 4200, openContracts: 1 },
      openContracts: [progress()],
    });
    renderAt('/customers/c1');
    expect(await screen.findByText('ลูกค้าดี')).toBeInTheDocument();
    expect(screen.getByText('ลูกค้าประจำ')).toBeInTheDocument();
    expect(screen.getByText('คงค้าง')).toBeInTheDocument();
    expect(screen.getByText(/ค้างชำระ 1 งวด/, { selector: '[data-testid="risk-banner"] *' })).toBeInTheDocument();
    // R2: อีกงานสร้างปุ่ม "รับชำระ" ตัวที่สองในการ์ดสัญญา — ต้องขอบเขตแค่ในแถบเตือนเท่านั้น
    fireEvent.click(within(screen.getByTestId('risk-banner')).getByRole('button', { name: 'รับชำระ' }));
    expect(await screen.findByLabelText('current location')).toHaveTextContent('/payments?contractId=k1');
  });

  it('ผู้สนใจจากแชท (SALES): ป้ายผู้สนใจ · ไม่มีเบอร์ · ปุ่มเติมเบอร์ · 4 ช่อง · เมนูไม่มีสร้างสัญญา', async () => {
    mocks.role = 'SALES';
    mocks.detail = detail({ phone: null, chatPlaceholder: true, source: 'FACEBOOK', purchase: emptyPurchase, contracts: [] });
    renderAt('/customers/c1');
    expect(await screen.findByText('ผู้สนใจ')).toBeInTheDocument();
    expect(screen.getAllByText('จากแชท · ยังไม่มีเบอร์').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'เติมเบอร์' })).toBeInTheDocument();
    for (const label of ['ที่มา', 'ติดต่อล่าสุด', 'ผู้ดูแล', 'เครดิต']) expect(screen.getByText(label)).toBeInTheDocument();
    // R2/Step 8 fallback: jsdom ไม่มี window.PointerEvent (@testing-library/dom fireEvent
    // จึงคืนกลับไปสร้าง Event ธรรมดา — DropdownMenuTrigger เช็ค `event.button === 0` เลย
    // toggle ไม่ติด) userEvent.click จำลอง pointerdown/click ครบชุดจึงเปิดเมนู Radix ได้จริง
    const trigger = screen.getByRole('button', { name: /ดำเนินการ/ });
    const user = userEvent.setup();
    await user.click(trigger);
    expect(await screen.findByRole('menuitem', { name: 'ตรวจเครดิตใหม่' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'สร้างสัญญาผ่อน' })).toBeNull();
  });

  it('คอลัมน์ขวา: เลขบัตรเต็มเฉพาะ OWNER · SALES เห็นแบบปิดบัง · LINE ยังไม่ผูก', async () => {
    mocks.detail = detail({ nationalId: '1101401234567' });
    const { unmount } = renderAt('/customers/c1');
    expect(await screen.findByText(formatNationalId('1101401234567'))).toBeInTheDocument();
    expect(screen.getAllByText('ยังไม่ผูก').length).toBe(2);
    unmount();
    mocks.role = 'SALES';
    renderAt('/customers/c1');
    expect(await screen.findByText(maskNationalId('1101401234567'))).toBeInTheDocument();
  });

  it('ลิงก์เก่า ?tab=contact ยังเปิดได้ (ข้อมูลติดต่อย้ายไปคอลัมน์ขวา)', async () => {
    renderAt('/customers/c1?tab=contact');
    expect(await screen.findByRole('heading', { level: 1, name: 'สมชาย ใจดี' })).toBeInTheDocument();
    expect(screen.getByText('ติดต่อ')).toBeInTheDocument();
  });
});
