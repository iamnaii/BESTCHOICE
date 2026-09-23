import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import AfterSalesCasePage from './AfterSalesCasePage';
import type { CaseDetail } from './after-sales/after-sales';

const auth = vi.hoisted(() => ({
  user: { id: 'u1', role: 'OWNER', branchId: null as string | null },
}));
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post },
  getErrorMessage: (error: Error) => error.message,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));

function caseDetail(over: Partial<CaseDetail> = {}): CaseDetail {
  const base: CaseDetail = {
    id: 'case-1',
    caseNumber: 'AS-20260908-0001',
    source: 'INSTALLMENT_CONTRACT',
    outcome: 'REPAIR',
    stage: 'IN_REPAIR',
    stale: true,
    daysInStage: 16,
    receivedAt: '2026-09-01T02:00:00.000Z',
    deviceBrand: 'Apple',
    deviceModel: 'iPhone 13',
    deviceImei: '359123456789012',
    customer: { id: 'cust-1', name: 'คุณสมหญิง ตาราง', phone: '0812345678' },
    branch: { id: 'branch-1', name: 'ลาดพร้าว' },
    receivedBy: { id: 'user-1', name: 'ธนา' },
    repairTicket: {
      id: 'rt-1',
      ticketNumber: 'RT-20260908-0001',
      status: 'IN_PROGRESS',
      payer: 'SHOP',
      estimatedCost: '1500.00',
      actualCost: null,
      sentToRepairAt: '2026-09-08T03:00:00.000Z',
      repairedAt: null,
      externalClaimNo: null,
      repairSupplier: { id: 'sup-1', name: 'ศูนย์ซ่อม เอ' },
      expenseDocument: null,
      otherIncome: null,
    },
    symptom: 'จอแตก เปิดไม่ติด',
    accessories: { box: true, charger: true, case: false },
    unlockConfirmed: true,
    warrantySnapshot: {
      status: 'IN_SHOP_WARRANTY',
      daysRemainingIn7Day: 0,
      shopWarrantyEndDate: '2026-12-01T00:00:00.000Z',
      manufacturerWarrantyEndDate: null,
      checkedAt: '2026-09-01T00:00:00.000Z',
    },
    photoCount: 3,
    purchasePhotoAngles: ['front', 'back'],
    lineLinked: false,
    timeline: [
      { at: '2026-09-01T02:00:00.000Z', kind: 'RECEIVED', note: null },
      { at: '2026-09-01T02:05:00.000Z', kind: 'OUTCOME_SET', note: 'เลือกทางออก: ซ่อม' },
      { at: '2026-09-08T03:00:00.000Z', kind: 'REPAIR_SENT', note: 'ส่งซ่อม' },
      { at: '2026-09-08T03:00:01.000Z', kind: 'REPAIR_IN_PROGRESS', note: null, actorName: 'ธนา' },
    ],
    cancelReason: null,
    closedAt: null,
    contractId: 'contract-1',
    saleId: null,
  };
  return { ...base, ...over };
}

function mockGet(detail: CaseDetail) {
  mocks.get.mockImplementation(async (url: string, config?: { responseType?: string }) => {
    if (config?.responseType === 'blob') return { data: new Blob(['x']) };
    if (url === `/after-sales/${detail.id}`) return { data: detail };
    throw new Error(`unexpected GET ${url}`);
  });
}

function renderPage(id = 'case-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[`/after-sales/${id}`]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/after-sales/:id" element={<AfterSalesCasePage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** ปุ่มหลักซ้ำในแถบมือถือ (sticky bottom-0 md:hidden) — jsdom ไม่ตัด CSS breakpoint ออก
 * จึงต้องกรอง data-testid="mobile-bar" ออกก่อนนับ (ตามที่ brief Step 6 ระบุ) */
function primaryButtonsOutsideMobileBar(name: string | RegExp) {
  return screen
    .getAllByRole('button', { name })
    .filter((btn) => !btn.closest('[data-testid="mobile-bar"]'));
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'u1', role: 'OWNER', branchId: null };
  // jsdom ไม่มี URL.createObjectURL/revokeObjectURL — ต้อง stub เอง (แบบ EvidenceImageLink)
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = vi.fn();
});

describe('AfterSalesCasePage — หน้าเคส /after-sales/:id', () => {
  it('(a) stage IN_REPAIR ค้าง 16 วัน: หัวเคส + chip ค้างนาน (มีไอคอน) + ปุ่มหลักเดียว + StepBar 4 ขั้น + ตารางเทียบรูป + ป้าย LINE', async () => {
    const detail = caseDetail();
    mockGet(detail);
    renderPage(detail.id);

    expect(await screen.findByRole('heading', { name: detail.caseNumber })).toBeInTheDocument();

    const staleChip = screen.getByText('ส่งศูนย์ 16 วัน (เกิน 14)');
    expect(staleChip).toBeInTheDocument();
    // chip ต้องมีไอคอน (svg) อยู่ในกล่องเดียวกัน ไม่ใช่แค่สีพื้น
    expect(staleChip.closest('span')?.querySelector('svg')).toBeInTheDocument();

    const primaryButtons = primaryButtonsOutsideMobileBar(/บันทึกซ่อมเสร็จ/);
    expect(primaryButtons).toHaveLength(1);

    // StepBar หัวข้อ — ไม่มีเลขนำหน้าซ้ำในข้อความหัวข้อ
    for (const title of ['รับเรื่องแล้ว', 'กำลังซ่อม', 'รอลูกค้ารับ', 'ปิดเคส']) {
      const el = screen.getByText(title);
      expect(el.textContent).toBe(title);
    }

    // ตารางเทียบรูป 6 หัวคอลัมน์
    for (const label of ['หน้า', 'หลัง', 'ซ้าย', 'ขวา', 'บน', 'ล่าง']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // photoCount 3 → เหลือ 3 ช่อง "ไม่ได้ถ่าย"
    expect(screen.getAllByText('ไม่ได้ถ่าย')).toHaveLength(3);

    expect(await screen.findByText('ยังไม่ผูก LINE — โทรแจ้ง')).toBeInTheDocument();
  });

  it('(b) กด "บันทึกซ่อมเสร็จ" → กรอกค่าซ่อมจริง 1500 + ผู้จ่าย → ยืนยัน → POST mark-repaired + toast.success', async () => {
    const detail = caseDetail();
    mockGet(detail);
    mocks.post.mockResolvedValue({ data: { id: detail.id, stage: 'READY_FOR_PICKUP' } });
    renderPage(detail.id);

    await screen.findByRole('heading', { name: detail.caseNumber });
    const [primaryButton] = primaryButtonsOutsideMobileBar(/บันทึกซ่อมเสร็จ/);
    await userEvent.click(primaryButton);

    const dialog = await screen.findByRole('dialog');
    const costInput = within(dialog).getByLabelText(/ค่าซ่อมจริง/);
    await userEvent.clear(costInput);
    await userEvent.type(costInput, '1500');
    const payerSelect = within(dialog).getByLabelText(/ผู้จ่าย/) as HTMLSelectElement;
    await userEvent.selectOptions(payerSelect, 'SHOP');

    const confirmButton = within(dialog).getByRole('button', { name: /ยืนยัน/ });
    await userEvent.click(confirmButton);

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(`/after-sales/${detail.id}/repair/mark-repaired`, {
        actualCost: 1500,
        payer: 'SHOP',
      }),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it('(c) stage READY_FOR_PICKUP → ปุ่มหลัก "ส่งมอบคืนลูกค้า" ปุ่มเดียว', async () => {
    const detail = caseDetail({
      stage: 'READY_FOR_PICKUP',
      stale: false,
      daysInStage: 2,
      repairTicket: {
        ...caseDetail().repairTicket!,
        status: 'READY_FOR_PICKUP',
        actualCost: '1500.00',
        repairedAt: '2026-09-10T00:00:00.000Z',
      },
    });
    mockGet(detail);
    renderPage(detail.id);

    await screen.findByRole('heading', { name: detail.caseNumber });
    const primaryButtons = primaryButtonsOutsideMobileBar('ส่งมอบคืนลูกค้า');
    expect(primaryButtons).toHaveLength(1);
  });

  it('(d) stage CLOSED → ไม่มีปุ่มหลัก แต่มีลิงก์เอกสารบัญชี (docNumber)', async () => {
    const detail = caseDetail({
      stage: 'CLOSED',
      stale: false,
      daysInStage: 0,
      closedAt: '2026-09-12T00:00:00.000Z',
      repairTicket: {
        ...caseDetail().repairTicket!,
        status: 'CLOSED',
        actualCost: '1500.00',
        repairedAt: '2026-09-10T00:00:00.000Z',
        expenseDocument: { id: 'ex-1', number: 'EX-20260908-0001' },
      },
    });
    mockGet(detail);
    renderPage(detail.id);

    await screen.findByRole('heading', { name: detail.caseNumber });
    expect(screen.queryByRole('button', { name: 'ส่งซ่อม' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'บันทึกซ่อมเสร็จ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ส่งมอบคืนลูกค้า' })).not.toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'EX-20260908-0001' });
    expect(link).toHaveAttribute('href', '/expenses/ex-1');
  });

  it('(e) ยกเลิกเคส: SALES ไม่เห็นปุ่ม "ยกเลิกเคส"; BRANCH_MANAGER เห็น', async () => {
    const detail = caseDetail({ stage: 'READY_FOR_PICKUP', stale: false, daysInStage: 2 });
    mockGet(detail);

    auth.user = { id: 'u-sales', role: 'SALES', branchId: 'branch-1' };
    const salesRender = renderPage(detail.id);
    await screen.findByRole('heading', { name: detail.caseNumber });
    expect(screen.queryByRole('button', { name: 'ยกเลิกเคส' })).not.toBeInTheDocument();
    salesRender.unmount();

    auth.user = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'branch-1' };
    renderPage(detail.id);
    await screen.findByRole('heading', { name: detail.caseNumber });
    expect(screen.getByRole('button', { name: 'ยกเลิกเคส' })).toBeInTheDocument();
  });
});
