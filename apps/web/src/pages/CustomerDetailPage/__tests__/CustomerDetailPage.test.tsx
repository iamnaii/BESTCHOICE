import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CustomerDetailPage from '@/pages/CustomerDetailPage';
import { formatNationalId, maskNationalId } from '@/utils/mask.util';
import { detail, emptyPurchase, progress, sale } from './fixtures';
import { STAGE_LABELS } from '@installment/shared';
import { formatDateShort, formatDateTime } from '@/utils/formatters';
import { allChipNote } from '../utils/journeyGroups';
import { journeyEvent, journeyPage, journeySummary, stageSteps } from './journeyFixtures';

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
  /** summary ต่อ customer id — id ที่ไม่ได้ตั้งจะโยน error ⇒ แถบขั้นไม่วาด */
  summaries: {} as Record<string, unknown>,
  /** ตอบ GET /customers/c1/journey ตาม params (limit / groups / cursor) */
  journey: vi.fn(),
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
  // ค่าเริ่มต้นไม่ตั้ง summary: แถบขั้นไม่วาด เทสของ Plan 1 ที่ getByText ข้อความสั้น ๆ จึงไม่เจอป้ายขั้นซ้ำ — เทสแถบขั้นตั้งเอง
  mocks.summaries = {};
  mocks.journey.mockReset();
  mocks.journey.mockImplementation(() => journeyPage());
  mocks.get.mockReset();
  mocks.get.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === '/customers/c1/detail') return { data: mocks.detail };
    const summaryId = /^\/customers\/([^/]+)\/journey\/summary$/.exec(url)?.[1];
    if (summaryId) {
      if (summaryId in mocks.summaries) return { data: mocks.summaries[summaryId] };
      throw new Error(`summary ไม่ได้ตั้งสำหรับ ${summaryId}`);
    }
    if (url === '/customers/c1/journey') return { data: mocks.journey(config?.params ?? {}) };
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
      if (url === '/customers/c1/detail') return { data: mocks.detail };
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
    // R6: /payments อ่านแค่ ?search= (ไม่มีที่ไหนอ่าน ?contractId=) — ปุ่มพาไปด้วยเลขที่สัญญา
    expect(await screen.findByLabelText('current location')).toHaveTextContent('/payments?search=CT-2569-0042');
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

  it('ลูกค้ามีเลขบัตรแต่ไม่มีเบอร์ (ไม่ใช่ผู้สนใจจากแชท): เมนูไม่เสนอสัญญา/หน้าขาย/หน้าจอง ที่ API จะปฏิเสธ', async () => {
    mocks.detail = detail({ nationalId: '1101401234567', phone: null, chatPlaceholder: false });
    renderAt('/customers/c1');
    await screen.findByRole('heading', { level: 1, name: 'สมชาย ใจดี' });
    // เติมเบอร์รับเฉพาะผู้สนใจจากแชท (chatPlaceholder) — คนนี้ไม่ใช่ จึงไม่มีปุ่ม
    expect(screen.queryByRole('button', { name: 'เติมเบอร์' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: /ดำเนินการ/ }));
    expect(await screen.findByRole('menuitem', { name: 'ตรวจเครดิตใหม่' })).toBeInTheDocument();
    for (const label of ['สร้างสัญญาผ่อน', 'เปิดหน้าขาย', 'เปิดหน้าจอง / มัดจำ']) {
      expect(screen.queryByRole('menuitem', { name: label })).toBeNull();
    }
  });

  it('ค้างหลายสัญญา: แถบเตือนชี้ใบที่ค้างนานสุด และ "รับชำระ" ค้นด้วยเบอร์ลูกค้าให้เห็นทุกใบ', async () => {
    const phone = '0812345678';
    mocks.detail = detail({
      phone,
      purchase: { ...emptyPurchase, installmentTotal: 2 },
      installmentBalance: { outstanding: 50400, nextDueDate: '2026-10-05T00:00:00.000Z', nextAmountDue: 4200, openContracts: 2 },
      // API เรียงใบใหม่สุดก่อน — ใบค้างนานสุดอยู่ท้าย
      openContracts: [
        progress({ id: 'k1', contractNumber: 'CT-NEW-0001', firstOverdueInstallmentNo: 2, firstOverdueDueDate: '2026-09-05T00:00:00.000Z' }),
        progress({ id: 'k2', contractNumber: 'CT-OLD-0002', firstOverdueInstallmentNo: 5, firstOverdueDueDate: '2026-06-05T00:00:00.000Z' }),
      ],
    });
    renderAt('/customers/c1');
    const banner = await screen.findByTestId('risk-banner');
    expect(within(banner).getByText(/ค้างชำระ 2 งวด/)).toBeInTheDocument();
    expect(within(banner).getByText('CT-OLD-0002')).toBeInTheDocument();
    expect(within(banner).queryByText('CT-NEW-0001')).toBeNull();
    fireEvent.click(within(banner).getByRole('button', { name: 'รับชำระ' }));
    expect(await screen.findByLabelText('current location')).toHaveTextContent(`/payments?search=${encodeURIComponent(phone)}`);
  });

  it('ค้างหลายสัญญา: "รับชำระ" ในเมนูดำเนินการก็ค้นด้วยเบอร์เดียวกัน', async () => {
    const phone = '0812345678';
    mocks.detail = detail({
      phone,
      purchase: { ...emptyPurchase, installmentTotal: 2 },
      openContracts: [
        progress({ id: 'k1', contractNumber: 'CT-NEW-0001', firstOverdueDueDate: '2026-09-05T00:00:00.000Z' }),
        progress({ id: 'k2', contractNumber: 'CT-OLD-0002', firstOverdueDueDate: '2026-06-05T00:00:00.000Z' }),
      ],
    });
    renderAt('/customers/c1');
    await screen.findByTestId('risk-banner');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /ดำเนินการ/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'รับชำระ' }));
    expect(await screen.findByLabelText('current location')).toHaveTextContent(`/payments?search=${encodeURIComponent(phone)}`);
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

describe('แท็บภาพรวม', () => {
  it('เป็นแท็บเริ่มต้น และการ์ดสัญญาที่กำลังผ่อนบอกงวด ยอด และพาไปหน้าสัญญา', async () => {
    mocks.detail = detail({
      purchase: { ...emptyPurchase, installmentTotal: 1 },
      installmentBalance: { outstanding: 25200, nextDueDate: '2026-10-05T00:00:00.000Z', nextAmountDue: 4200, openContracts: 1 },
      openContracts: [progress()],
    });
    renderAt('/customers/c1');
    const card = await screen.findByTestId('active-contract-k1');
    expect(within(card).getByText('ผ่อนแล้ว 6/12 งวด')).toBeInTheDocument();
    expect(within(card).getByText('งวด 7 · 4,200 ฿')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'ดูสัญญา' }));
    expect(await screen.findByLabelText('current location')).toHaveTextContent('/contracts/k1');
  });

  it('ปุ่ม "รับชำระ" ในการ์ดพาไปหน้าชำระด้วยเลขที่สัญญา (R6)', async () => {
    mocks.detail = detail({
      purchase: { ...emptyPurchase, installmentTotal: 1 },
      installmentBalance: { outstanding: 25200, nextDueDate: '2026-10-05T00:00:00.000Z', nextAmountDue: 4200, openContracts: 1 },
      openContracts: [progress()],
    });
    renderAt('/customers/c1');
    const card = await screen.findByTestId('active-contract-k1');
    fireEvent.click(within(card).getByRole('button', { name: 'รับชำระ' }));
    expect(await screen.findByLabelText('current location')).toHaveTextContent('/payments?search=CT-2569-0042');
  });

  it('ลิงก์เก่า ?tab=info พามาที่ภาพรวม', async () => {
    mocks.detail = detail({ purchase: { ...emptyPurchase, installmentTotal: 1 }, openContracts: [progress()] });
    renderAt('/customers/c1?tab=info');
    expect(await screen.findByTestId('active-contract-k1')).toBeInTheDocument();
  });

  it('?tab= ที่ไม่รู้จัก → กลับไปแท็บภาพรวม ไม่ใช่หน้าว่าง', async () => {
    mocks.detail = detail({ purchase: { ...emptyPurchase, installmentTotal: 1 }, openContracts: [progress()] });
    renderAt('/customers/c1?tab=nope');
    expect(await screen.findByTestId('active-contract-k1')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'ภาพรวม' })).toHaveAttribute('data-state', 'active');
  });

  it('ผู้สนใจที่ยังไม่มีเบอร์ บอกขั้นต่อไปตามจริง', async () => {
    mocks.detail = detail({ phone: null, chatPlaceholder: true, purchase: emptyPurchase, contracts: [] });
    renderAt('/customers/c1');
    expect(await screen.findByText('ยังไม่มีเบอร์ — เปิดสัญญา / ใบขาย / ใบจองได้เมื่อมีเบอร์')).toBeInTheDocument();
  });

  // R7: ปุ่ม "ดูทั้งหมด" ในการ์ดใบขายของแท็บภาพรวม ต้องพาไปแท็บ 'sales' (เดิมชื่อ 'purchases')
  it('ปุ่ม "ดูทั้งหมด" ในการ์ดใบขายพาไปแท็บใบขาย (R7)', async () => {
    mocks.detail = detail({ sales: [1, 2, 3, 4].map((n) => sale({ id: `s${n}`, saleNumber: `SL-2569-000${n}` })) });
    renderAt('/customers/c1');
    fireEvent.click(await screen.findByRole('button', { name: 'ดูทั้งหมด' }));
    expect(await screen.findByRole('tab', { name: /ใบขาย/ })).toHaveAttribute('data-state', 'active');
  });
});

describe('ชุดแท็บ', () => {
  it('ลำดับแท็บ + แท็บที่ไม่มีข้อมูลโชว์จางแต่ยังกดได้', async () => {
    mocks.detail = detail({ contracts: [], sales: [] });
    renderAt('/customers/c1');
    await screen.findByRole('heading', { level: 1, name: 'สมชาย ใจดี' });
    const names = screen.getAllByRole('tab').map((tab) => tab.textContent?.replace(/\s+/g, ' ').trim());
    expect(names).toEqual(['ภาพรวม', 'สัญญา (0)', 'ใบขาย (0)', 'เครดิต (0)', expect.stringMatching(/^แต้มสะสม/), 'การเดินทาง']);
    const salesTab = screen.getByRole('tab', { name: /ใบขาย/ });
    expect(salesTab).toHaveAttribute('data-empty', 'true');
    fireEvent.mouseDown(salesTab);
    fireEvent.click(salesTab);
    expect(await screen.findByText('ยังไม่มีการซื้อแบบเงินสด/ไฟแนนซ์นอก')).toBeInTheDocument();
  });

  it('ลิงก์เก่า ?tab=purchases เปิดแท็บใบขาย', async () => {
    mocks.detail = detail({ sales: [] });
    renderAt('/customers/c1?tab=purchases');
    expect(await screen.findByText('ยังไม่มีการซื้อแบบเงินสด/ไฟแนนซ์นอก')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /ใบขาย/ })).toHaveAttribute('data-state', 'active');
  });
});

describe('การเดินทางของลูกค้า', () => {
  it('แถบขั้นอยู่ใต้ช่องตัวเลข: ขั้นปัจจุบัน วันที่เข้าขั้น และวันที่ค้าง', async () => {
    mocks.detail = detail({ phone: null, chatPlaceholder: true, source: 'FACEBOOK', purchase: emptyPurchase, contracts: [] });
    mocks.summaries.c1 = journeySummary({
      stage: 'INTERESTED',
      daysInStage: 3,
      steps: stageSteps(
        { CONTACTED: 'done', IDENTIFIED: 'done', INTERESTED: 'current', CREDIT: 'todo', PURCHASED: 'todo' },
        { CONTACTED: '2026-09-01T03:00:00.000Z', IDENTIFIED: '2026-09-02T03:00:00.000Z', INTERESTED: '2026-09-12T03:00:00.000Z' },
      ),
    });
    renderAt('/customers/c1');
    const strip = await screen.findByRole('region', { name: 'ขั้นการเดินทางของลูกค้า' });
    const current = within(strip).getByText(STAGE_LABELS.INTERESTED).closest('li');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(current).toHaveTextContent(`${formatDateShort('2026-09-12T03:00:00.000Z')} · อยู่ขั้นนี้ 3 วัน`);
    // ผู้สนใจ → ช่องตัวเลขช่องแรกคือ "ที่มา" (kpiTiles.ts) — แถบต้องมาหลังช่องตัวเลข
    const firstTileLabel = screen.getAllByText('ที่มา')[0];
    expect(firstTileLabel.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('ภาพรวม: การ์ดกิจกรรมล่าสุดขอ 6 รายการของแชท·เครดิต·ขาย และปุ่มพาไปแท็บการเดินทาง', async () => {
    mocks.journey.mockImplementation((params: Record<string, unknown>) =>
      params.limit === 6
        ? journeyPage({
            events: [
              journeyEvent({
                id: 'contract-k1',
                type: 'CONTRACT_SIGNED',
                group: 'sale',
                stage: 'PURCHASED',
                timestamp: '2026-08-20T09:05:00.000Z',
                title: 'เซ็นสัญญา CT-2569-0042',
                actor: { type: 'STAFF', name: 'บอส' },
                href: '/contracts/k1',
              }),
            ],
          })
        : journeyPage(),
    );
    renderAt('/customers/c1');
    expect(await screen.findByRole('heading', { name: 'กิจกรรมล่าสุด' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'เซ็นสัญญา CT-2569-0042' })).toHaveAttribute('href', '/contracts/k1');
    expect(screen.getByText(`${formatDateTime('2026-08-20T09:05:00.000Z')} · บอส`)).toBeInTheDocument();
    expect(mocks.journey).toHaveBeenCalledWith({ limit: 6, groups: 'chat,credit,sale' });

    fireEvent.click(screen.getByRole('button', { name: 'ดูการเดินทางทั้งหมด' }));
    expect(await screen.findByRole('tab', { name: 'การเดินทาง', selected: true })).toBeInTheDocument();
    expect(screen.getByLabelText('current location')).toHaveTextContent('/customers/c1?tab=journey');
    await waitFor(() => expect(mocks.journey).toHaveBeenCalledWith({ limit: 30, include: 'counts' }));
  });

  it('แท็บการเดินทาง: ป้ายประมาณจาก reliability · ไม่แสดง metadata · โหลดเพิ่มด้วย cursor จนหมด', async () => {
    mocks.journey.mockImplementation((params: Record<string, unknown>) =>
      params.cursor === 'cur-2'
        ? journeyPage({ events: [journeyEvent({ id: 'chat_room-r1', title: 'ทักแชทครั้งแรกทาง Facebook' })] })
        : journeyPage({
            events: [
              journeyEvent({
                id: 'credit_check-k1',
                type: 'CREDIT_CHECK_OPENED',
                group: 'credit',
                stage: 'CREDIT',
                timestamp: '2026-09-10T03:00:00.000Z',
                title: 'เปิดตรวจเครดิต (จากสเตทเม้นในแชท)',
                subtitle: 'คะแนน 72',
                actor: null,
                reliability: 'approximate',
                metadata: { leaked: '0899999999' },
              }),
            ],
            nextCursor: 'cur-2',
            counts: { chat: 1, credit: 1 },
          }),
    );
    renderAt('/customers/c1?tab=journey');
    expect(await screen.findByText('เปิดตรวจเครดิต (จากสเตทเม้นในแชท)')).toBeInTheDocument();
    const [item] = screen.getAllByTestId('event-timeline-item');
    expect(within(item).getByText('คะแนน 72')).toBeInTheDocument();
    expect(within(item).getByText('ประมาณ')).toBeInTheDocument();
    expect(screen.queryByText(/0899999999/)).toBeNull();
    // ชิปแสดงจำนวนจาก counts ของหน้าแรก (Task 9) ต่อท้ายป้าย
    expect(screen.getByRole('button', { name: /^เครดิต\s*1$/ })).toHaveAttribute('aria-pressed', 'false');
    expect(mocks.journey).toHaveBeenCalledWith({ limit: 30, include: 'counts' });

    fireEvent.click(screen.getByRole('button', { name: 'โหลดเพิ่ม' }));
    expect(await screen.findByText('ทักแชทครั้งแรกทาง Facebook')).toBeInTheDocument();
    // หน้าที่มี cursor ไม่ส่ง include (API ไม่แนบ counts ให้หน้าถัดไปอยู่แล้ว)
    expect(mocks.journey).toHaveBeenCalledWith({ limit: 30, cursor: 'cur-2' });
    expect(screen.queryByRole('button', { name: 'โหลดเพิ่ม' })).toBeNull();
  });

  it('ชิปกลุ่ม: กดแชทแล้วขอ groups=chat · OWNER เห็นชำระเงิน · SALES เห็นชำระเงินและติดตามหนี้ (OD-10)', async () => {
    const { unmount } = renderAt('/customers/c1?tab=journey');
    expect(await screen.findByRole('button', { name: 'ชำระเงิน' })).toBeInTheDocument();
    const note = allChipNote('OWNER');
    expect(note).not.toBeNull();
    expect(screen.getByText(String(note))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'แชท/ติดต่อ' }));
    await waitFor(() => expect(mocks.journey).toHaveBeenCalledWith({ limit: 30, groups: 'chat', include: 'counts' }));
    expect(await screen.findByText('ยังไม่มีกิจกรรมในกลุ่มนี้')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'แชท/ติดต่อ' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(String(note))).toBeNull();
    unmount();

    mocks.role = 'SALES';
    renderAt('/customers/c1?tab=journey');
    expect(await screen.findByRole('button', { name: 'เครดิต' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ชำระเงิน(\s*\d+)?$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ติดตามหนี้(\s*\d+)?$/ })).toBeInTheDocument();
    expect(screen.getByText(String(allChipNote('SALES')))).toBeInTheDocument();
  });

  it('ไม่มีกิจกรรม → ข้อความว่าง · รายการ "ระบบยังไม่เก็บ" พับไว้และกางได้', async () => {
    mocks.journey.mockImplementation(() => journeyPage({ notRecorded: ['ลูกค้าหน้าร้านรู้จักร้านจากไหน', 'ผู้ถอดแท็ก การบล็อก/เลิกติดตาม LINE และการเข้าชมเว็บ'] }));
    renderAt('/customers/c1?tab=journey');
    expect(await screen.findByText('ยังไม่มีกิจกรรม')).toBeInTheDocument();
    expect(screen.queryByText('ลูกค้าหน้าร้านรู้จักร้านจากไหน')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /ระบบยังไม่เก็บ \(2\)/ }));
    expect(await screen.findByText('ลูกค้าหน้าร้านรู้จักร้านจากไหน')).toBeInTheDocument();
    expect(screen.getByText('ผู้ถอดแท็ก การบล็อก/เลิกติดตาม LINE และการเข้าชมเว็บ')).toBeInTheDocument();
  });

  it('ลิงก์เก่าของผู้สนใจที่ถูกรวมแล้ว → summary ตอบ redirectToCustomerId → ไปหน้าลูกค้าจริง', async () => {
    mocks.summaries.old = { redirectToCustomerId: 'c1' };
    renderAt('/customers/old');
    await waitFor(() => expect(screen.getByLabelText('current location')).toHaveTextContent('/customers/c1'));
    expect(await screen.findByRole('heading', { level: 1, name: 'สมชาย ใจดี' })).toBeInTheDocument();
  });

  it('บทบาทที่ API การเดินทางไม่อนุญาต → ไม่มีแท็บ ไม่มีแถบขั้น ไม่มีการ์ด และไม่ยิง API', async () => {
    mocks.role = 'VIEWER';
    renderAt('/customers/c1');
    await screen.findByRole('heading', { level: 1, name: 'สมชาย ใจดี' });
    expect(screen.queryByRole('tab', { name: 'การเดินทาง' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'ขั้นการเดินทางของลูกค้า' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'กิจกรรมล่าสุด' })).toBeNull();
    expect(mocks.get).not.toHaveBeenCalledWith('/customers/c1/journey/summary');
    expect(mocks.journey).not.toHaveBeenCalled();
  });

  it('?tab=journey ของบทบาทที่ไม่เห็นการเดินทาง → แท็บภาพรวม ไม่ใช่หน้าว่าง', async () => {
    mocks.role = 'VIEWER';
    renderAt('/customers/c1?tab=journey');
    await screen.findByRole('heading', { level: 1, name: 'สมชาย ใจดี' });
    expect(screen.getByRole('tab', { name: 'ภาพรวม' })).toHaveAttribute('data-state', 'active');
    expect(screen.queryByRole('tab', { name: 'การเดินทาง' })).toBeNull();
  });

  // preflight carry (ก): หน้าอาจว่างทั้งที่ nextCursor ยังไม่เป็น null — ต้องตัดสินจาก cursor ไม่ใช่จำนวนรายการ
  it('หน้าแรกว่างแต่ยังมี cursor → ดึงหน้าถัดไปเองจนเจอรายการ ไม่ขึ้นว่า "ยังไม่มีกิจกรรม"', async () => {
    mocks.journey.mockImplementation((params: Record<string, unknown>) =>
      params.cursor === 'cur-2'
        ? journeyPage({ events: [journeyEvent({ id: 'chat_room-r1', title: 'ทักแชทครั้งแรกทาง Facebook' })] })
        : journeyPage({ nextCursor: 'cur-2' }),
    );
    renderAt('/customers/c1?tab=journey');
    expect(await screen.findByText('ทักแชทครั้งแรกทาง Facebook')).toBeInTheDocument();
    expect(mocks.journey).toHaveBeenCalledWith({ limit: 30, cursor: 'cur-2' });
    expect(screen.queryByText('ยังไม่มีกิจกรรม')).toBeNull();
  });

  // final review F4: main.tsx ปิด refetchOnWindowFocus — คำสั่งบนหน้าที่เขียนประวัติการเดินทางต้อง invalidate เอง
  // ไม่งั้นการ์ดกิจกรรมล่าสุด/แถบขั้นค้างรายการเก่าข้างตัวเลขที่รีเฟรชแล้ว
  it('บันทึกแก้ไขข้อมูลลูกค้า → การ์ดกิจกรรมล่าสุดและแถบขั้นดึงข้อมูลการเดินทางใหม่', async () => {
    mocks.summaries.c1 = journeySummary();
    mocks.patch.mockReset();
    mocks.patch.mockResolvedValue({ data: {} });
    const summaryCalls = () => mocks.get.mock.calls.filter(([url]) => url === '/customers/c1/journey/summary').length;
    renderAt('/customers/c1');
    expect(await screen.findByRole('heading', { name: 'กิจกรรมล่าสุด' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.journey).toHaveBeenCalledWith({ limit: 6, groups: 'chat,credit,sale' }));
    await waitFor(() => expect(summaryCalls()).toBeGreaterThan(0));
    const journeyBefore = mocks.journey.mock.calls.length;
    const summaryBefore = summaryCalls();

    fireEvent.click(screen.getByRole('button', { name: 'แก้ไขข้อมูล' }));
    const dialog = await screen.findByRole('dialog', { name: 'แก้ไขข้อมูลลูกค้า' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/customers/c1', expect.any(Object)));
    await waitFor(() => expect(mocks.journey.mock.calls.length).toBeGreaterThan(journeyBefore));
    await waitFor(() => expect(summaryCalls()).toBeGreaterThan(summaryBefore));
  });
});
