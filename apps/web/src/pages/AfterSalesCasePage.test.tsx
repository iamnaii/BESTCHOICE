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
// mock ทั้ง component (ไม่ใช่แค่ ContactCombobox ข้างใน) — พฤติกรรมค้นหา/debounce ของ
// combobox จริงไม่ใช่สิ่งที่ Task 11 ทดสอบ; แค่ต้องเรียก onSelect ด้วย payload ที่ถูกต้อง
// (ตรวจจาก RepairCenterCombobox.tsx: onSelect({ id: childId, name }) — R22 fix round 1)
vi.mock('@/pages/insurance/components/RepairCenterCombobox', () => ({
  RepairCenterCombobox: ({ onSelect }: { onSelect: (s: { id: string; name: string }) => void }) => (
    <button type="button" onClick={() => onSelect({ id: 'sup-1', name: 'iCare' })}>
      เลือกศูนย์ซ่อม (ทดสอบ)
    </button>
  ),
}));

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
    replacementProductId: null,
    replacementContractId: null,
    exchange: null,
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

function renderPage(id = 'case-1', search = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[`/after-sales/${id}${search}`]}>
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

/** Task 11 — ทุกเทสต์ของปุ่มหลัก/รองต้องนับปุ่มสีเขียว (`bg-primary`) นอกแถบมือถือได้ตรงตาม
 * ที่คาดหวัง (1 เมื่อมีปุ่มหลัก, 0 เมื่อไม่มี — role ไม่พอ/CLOSED/CANCELLED ฯลฯ) กันไม่ให้มีปุ่มเขียว
 * มากกว่าหนึ่งปุ่มบนหน้าเดียวกันโดยไม่ตั้งใจ */
function countGreenPrimaryButtons(container: HTMLElement) {
  return Array.from(container.querySelectorAll('button.bg-primary')).filter(
    (btn) => !btn.closest('[data-testid="mobile-bar"]'),
  ).length;
}

function sameModelExchange(over: Partial<NonNullable<CaseDetail['exchange']>> = {}) {
  return {
    kind: 'SAME_MODEL' as const,
    mode: null,
    approvalTier: null,
    requestStatus: null,
    buybackPrice: null,
    ncvSnapshot: null,
    approverRole: 'BRANCH_MANAGER' as const,
    oldProduct: {
      brand: 'Samsung',
      model: 'A55',
      storage: '128GB',
      imeiSerial: '3542...1188',
    },
    newProduct: {
      id: 'prod-2',
      brand: 'Samsung',
      model: 'A55',
      storage: '128GB',
      imeiSerial: '3542...2260',
    },
    replacementContract: null,
    requestedBy: { id: 'u1', name: 'นิภา' },
    ...over,
  };
}

function pricedExchange(over: Partial<NonNullable<CaseDetail['exchange']>> = {}) {
  return {
    kind: 'PRICED' as const,
    mode: 'PRICED' as const,
    approvalTier: 'REVIEW' as const,
    requestStatus: 'PENDING' as const,
    buybackPrice: '8500.00',
    ncvSnapshot: '10000.00',
    approverRole: 'BRANCH_MANAGER' as const,
    oldProduct: null,
    newProduct: null,
    replacementContract: null,
    requestedBy: { id: 'u1', name: 'นิภา' },
    ...over,
  };
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

    const staleChip = screen.getByText('ส่งศูนย์ 16 วัน (เกณฑ์ 14 วัน)');
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

  it('(f) stage RECEIVED: กด "ส่งซ่อม" → ยืนยันปิดจนกว่าจะเลือกศูนย์ซ่อม → กรอกเลขเคลม+ค่าซ่อมประมาณ → POST repair/send', async () => {
    const base = caseDetail();
    const detail = caseDetail({
      stage: 'RECEIVED',
      stale: false,
      daysInStage: 0,
      repairTicket: {
        ...base.repairTicket!,
        status: 'OPEN',
        repairSupplier: null,
        sentToRepairAt: null,
      },
    });
    mockGet(detail);
    mocks.post.mockResolvedValue({ data: { id: detail.id, stage: 'IN_REPAIR' } });
    renderPage(detail.id);

    await screen.findByRole('heading', { name: detail.caseNumber });
    const [primaryButton] = primaryButtonsOutsideMobileBar('ส่งซ่อม');
    await userEvent.click(primaryButton);

    const dialog = await screen.findByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'ส่งซ่อม' });
    expect(confirmButton).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'เลือกศูนย์ซ่อม (ทดสอบ)' }));
    expect(confirmButton).not.toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('เลขเคลม'), 'IC-1');
    await userEvent.type(within(dialog).getByLabelText(/ค่าซ่อมประมาณ/), '1500');
    await userEvent.click(confirmButton);

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(`/after-sales/${detail.id}/repair/send`, {
        repairSupplierId: 'sup-1',
        externalClaimNo: 'IC-1',
        estimatedCost: 1500,
      }),
    );
  });

  // C4b (final-fix brief) — เอกสารค่าใช้จ่าย/รายได้อื่นต้องเป็นลิงก์เฉพาะ role ที่เปิด
  // /expenses/:id หรือ /other-income/:id ได้จริง (mirror ของ roles บน App.tsx)
  it('(g) เอกสารค่าใช้จ่าย (expenseDocument): BRANCH_MANAGER (เข้า /expenses/:id ได้) → ลิงก์; SALES (เข้าไม่ได้) → ข้อความล้วน', async () => {
    const detail = caseDetail({
      stage: 'CLOSED',
      stale: false,
      daysInStage: 0,
      repairTicket: {
        ...caseDetail().repairTicket!,
        status: 'CLOSED',
        expenseDocument: { id: 'ex-2', number: 'EX-20260908-0002' },
      },
    });
    mockGet(detail);

    auth.user = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'branch-1' };
    const bmRender = renderPage(detail.id);
    await screen.findByRole('heading', { name: detail.caseNumber });
    expect(screen.getByRole('link', { name: 'EX-20260908-0002' })).toHaveAttribute(
      'href',
      '/expenses/ex-2',
    );
    bmRender.unmount();

    auth.user = { id: 'u-sales', role: 'SALES', branchId: 'branch-1' };
    renderPage(detail.id);
    await screen.findByRole('heading', { name: detail.caseNumber });
    expect(screen.queryByRole('link', { name: 'EX-20260908-0002' })).not.toBeInTheDocument();
    expect(screen.getByText('EX-20260908-0002')).toBeInTheDocument();
  });

  it('(h) เอกสารรายได้อื่น (otherIncome): FINANCE_MANAGER (เข้า /other-income/:id ได้) → ลิงก์; BRANCH_MANAGER (เข้าไม่ได้) → ข้อความล้วน', async () => {
    const detail = caseDetail({
      stage: 'CLOSED',
      stale: false,
      daysInStage: 0,
      repairTicket: {
        ...caseDetail().repairTicket!,
        status: 'CLOSED',
        expenseDocument: null,
        otherIncome: { id: 'oi-1', docNumber: 'OI-20260908-0001' },
      },
    });
    mockGet(detail);

    auth.user = { id: 'u-fm', role: 'FINANCE_MANAGER', branchId: null };
    const fmRender = renderPage(detail.id);
    await screen.findByRole('heading', { name: detail.caseNumber });
    expect(screen.getByRole('link', { name: 'OI-20260908-0001' })).toHaveAttribute(
      'href',
      '/other-income/oi-1',
    );
    fmRender.unmount();

    auth.user = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'branch-1' };
    renderPage(detail.id);
    await screen.findByRole('heading', { name: detail.caseNumber });
    expect(screen.queryByRole('link', { name: 'OI-20260908-0001' })).not.toBeInTheDocument();
    expect(screen.getByText('OI-20260908-0001')).toBeInTheDocument();
  });

  // C5 (final-fix brief) — warrantySnapshot ของแถวที่ backfill มา (`{status, checkedAt,
  // backfilled}`) ไม่มี daysRemainingIn7Day → ต้องไม่โชว์ "เหลืออีก undefined วัน"
  it('(i) warrantySnapshot รูปแบบ backfilled (ไม่มี daysRemainingIn7Day) → ไม่โชว์ประโยค "เหลืออีก...วัน"', async () => {
    const detail = caseDetail({
      warrantySnapshot: {
        status: 'IN_7DAY_DEFECT',
        checkedAt: '2026-09-01T00:00:00.000Z',
      } as never,
    });
    mockGet(detail);
    renderPage(detail.id);

    await screen.findByRole('heading', { name: detail.caseNumber });
    expect(screen.queryByText(/เหลืออีก/)).not.toBeInTheDocument();
  });

  it('(j) SAME_MODEL_EXCHANGE AWAITING_APPROVAL + BM → ปุ่มหลักเดียว "ยืนยันเปลี่ยนเครื่อง"; ติ๊ก 2 ข้อบังคับแล้วยืนยัน → POST exchange/confirm', async () => {
    const detail = caseDetail({
      outcome: 'SAME_MODEL_EXCHANGE',
      stage: 'AWAITING_APPROVAL',
      repairTicket: null,
      exchange: sameModelExchange(),
    });
    mockGet(detail);
    mocks.post.mockResolvedValue({ data: { id: detail.id, stage: 'READY_FOR_PICKUP' } });
    auth.user = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'branch-1' };
    const { container } = renderPage(detail.id);

    await screen.findByRole('heading', { name: detail.caseNumber });
    const primaryButtons = primaryButtonsOutsideMobileBar('ยืนยันเปลี่ยนเครื่อง');
    expect(primaryButtons).toHaveLength(1);
    expect(countGreenPrimaryButtons(container)).toBe(1);

    await userEvent.click(primaryButtons[0]);
    const dialog = await screen.findByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'ยืนยันเปลี่ยนเครื่อง' });
    expect(confirmButton).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'สภาพเครื่องเดิมตรงรูป' }));
    expect(confirmButton).toBeDisabled();
    await userEvent.click(
      within(dialog).getByRole('checkbox', { name: 'เครื่องใหม่จากสต๊อกสาขานี้ IMEI ตรง' }),
    );
    expect(confirmButton).not.toBeDisabled();

    await userEvent.click(confirmButton);
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(`/after-sales/${detail.id}/exchange/confirm`, {}),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it('(k) SAME_MODEL_EXCHANGE AWAITING_APPROVAL + SALES → ไม่มีปุ่มหลัก มีข้อความ "รอ ผจก.สาขา ยืนยัน" และปุ่มรอง "เปลี่ยนเป็น \'ซ่อม\' แทน"', async () => {
    const detail = caseDetail({
      outcome: 'SAME_MODEL_EXCHANGE',
      stage: 'AWAITING_APPROVAL',
      repairTicket: null,
      exchange: sameModelExchange(),
    });
    mockGet(detail);
    auth.user = { id: 'u-sales', role: 'SALES', branchId: 'branch-1' };
    const { container } = renderPage(detail.id);

    await screen.findByRole('heading', { name: detail.caseNumber });
    expect(screen.getByText('รอ ผจก.สาขา ยืนยัน')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "เปลี่ยนเป็น 'ซ่อม' แทน" })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ยืนยันเปลี่ยนเครื่อง' })).not.toBeInTheDocument();
    expect(countGreenPrimaryButtons(container)).toBe(0);
  });

  it('(l) SAME_MODEL_EXCHANGE READY_FOR_PICKUP + replacementContractId (สัญญาใหม่ยัง DRAFT) → ปุ่ม "ส่งมอบเครื่องใหม่" กด → API 400 → toast.error ข้อความ API', async () => {
    const detail = caseDetail({
      outcome: 'SAME_MODEL_EXCHANGE',
      stage: 'READY_FOR_PICKUP',
      repairTicket: null,
      replacementContractId: 'ct-2',
      exchange: sameModelExchange({
        replacementContract: { id: 'ct-2', contractNumber: 'CT-2026-0099', status: 'DRAFT' },
      }),
    });
    mockGet(detail);
    mocks.post.mockRejectedValue(
      new Error('ต้องเปิดใช้สัญญาใหม่ CT-2026-0099 ที่หน้าสัญญาก่อนส่งมอบ'),
    );
    const { container } = renderPage(detail.id);

    await screen.findByRole('heading', { name: detail.caseNumber });
    const primaryButtons = primaryButtonsOutsideMobileBar('ส่งมอบเครื่องใหม่');
    expect(primaryButtons).toHaveLength(1);
    expect(countGreenPrimaryButtons(container)).toBe(1);
    expect(screen.getByRole('link', { name: /สัญญาใหม่ CT-2026-0099/ })).toHaveAttribute(
      'href',
      '/contracts/ct-2',
    );

    await userEvent.click(primaryButtons[0]);
    const confirmButton = await screen.findByRole('button', { name: 'ยืนยันส่งมอบ' });
    await userEvent.click(confirmButton);

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(`/after-sales/${detail.id}/exchange/deliver`, {}),
    );
    expect(toast.error).toHaveBeenCalledWith(
      'ต้องเปิดใช้สัญญาใหม่ CT-2026-0099 ที่หน้าสัญญาก่อนส่งมอบ',
    );
  });

  it('(m) PRICED_EXCHANGE AWAITING_APPROVAL tier ESCALATE → BM ไม่มีปุ่ม มี "รอ เจ้าของเท่านั้น อนุมัติ"; OWNER มีปุ่ม "อนุมัติ"', async () => {
    const detail = caseDetail({
      outcome: 'PRICED_EXCHANGE',
      stage: 'AWAITING_APPROVAL',
      repairTicket: null,
      exchange: pricedExchange({
        approvalTier: 'ESCALATE',
        approverRole: 'OWNER',
        buybackPrice: '4000.00',
      }),
    });
    mockGet(detail);

    auth.user = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'branch-1' };
    const bmRender = renderPage(detail.id);
    await screen.findByRole('heading', { name: detail.caseNumber });
    expect(screen.queryByRole('button', { name: 'อนุมัติ' })).not.toBeInTheDocument();
    expect(screen.getByText('รอ เจ้าของเท่านั้น อนุมัติ')).toBeInTheDocument();
    expect(countGreenPrimaryButtons(bmRender.container)).toBe(0);
    bmRender.unmount();

    auth.user = { id: 'u-owner', role: 'OWNER', branchId: null };
    const { container } = renderPage(detail.id);
    await screen.findByRole('heading', { name: detail.caseNumber });
    const primaryButtons = primaryButtonsOutsideMobileBar('อนุมัติ');
    expect(primaryButtons).toHaveLength(1);
    expect(countGreenPrimaryButtons(container)).toBe(1);
  });

  it('(n) PRICED_EXCHANGE MEMO AWAITING_APPROVAL + OWNER → dialog 2 checkbox ปิดปุ่มจนติ๊กครบ → POST approve {memoAddendumSigned:true, memoMdmSwapped:true}', async () => {
    const detail = caseDetail({
      outcome: 'PRICED_EXCHANGE',
      stage: 'AWAITING_APPROVAL',
      repairTicket: null,
      exchange: pricedExchange({ mode: 'MEMO', approvalTier: 'AUTO', buybackPrice: '12900.00' }),
    });
    mockGet(detail);
    mocks.post.mockResolvedValue({ data: { id: detail.id } });
    renderPage(detail.id);

    await screen.findByRole('heading', { name: detail.caseNumber });
    const [primaryButton] = primaryButtonsOutsideMobileBar('อนุมัติ');
    await userEvent.click(primaryButton);

    const dialog = await screen.findByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'อนุมัติ' });
    expect(confirmButton).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'เซ็น ADDENDUM แล้ว' }));
    expect(confirmButton).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'สลับ MDM แล้ว' }));
    expect(confirmButton).not.toBeDisabled();

    await userEvent.click(confirmButton);
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(`/after-sales/${detail.id}/approve`, {
        memoAddendumSigned: true,
        memoMdmSwapped: true,
      }),
    );
  });

  it('(o) REPAIR RECEIVED ไม่มีศูนย์ → ปุ่มหลัก "บันทึกซ่อมเสร็จ (ซ่อมที่ร้าน)" + ปุ่มรอง "ส่งซ่อม"', async () => {
    const detail = caseDetail({
      stage: 'RECEIVED',
      repairTicket: {
        ...caseDetail().repairTicket!,
        status: 'OPEN',
        repairSupplier: null,
        sentToRepairAt: null,
      },
    });
    mockGet(detail);
    const { container } = renderPage(detail.id);

    await screen.findByRole('heading', { name: detail.caseNumber });
    const primaryButtons = primaryButtonsOutsideMobileBar('บันทึกซ่อมเสร็จ (ซ่อมที่ร้าน)');
    expect(primaryButtons).toHaveLength(1);
    expect(countGreenPrimaryButtons(container)).toBe(1);
    expect(screen.getByRole('button', { name: 'ส่งซ่อม' })).toBeInTheDocument();
  });

  it('(p) REPAIR IN_REPAIR + BM + สัญญาผ่อน → ปุ่มรอง "ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม" เปิด picker เลือกเครื่องแล้วยืนยัน → POST exchange/confirm ส่ง replacementProductId', async () => {
    const detail = caseDetail({ stage: 'IN_REPAIR', contractId: 'contract-1' });
    mocks.get.mockImplementation(async (url: string, config?: { responseType?: string }) => {
      if (config?.responseType === 'blob') return { data: new Blob(['x']) };
      if (url === `/after-sales/${detail.id}`) return { data: detail };
      if (url === '/after-sales/replacement-products') {
        return {
          data: [
            {
              id: 'prod-9',
              brand: 'Apple',
              model: 'iPhone 13',
              storage: '128GB',
              color: null,
              imeiSerial: '359999999999999',
              cashPrice: '5000.00',
              branchId: 'branch-1',
            },
          ],
        };
      }
      throw new Error(`unexpected GET ${url}`);
    });
    mocks.post.mockResolvedValue({ data: { id: detail.id, stage: 'READY_FOR_PICKUP' } });
    auth.user = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'branch-1' };
    renderPage(detail.id);

    await screen.findByRole('heading', { name: detail.caseNumber });
    const secondaryButton = screen.getByRole('button', { name: 'ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม' });
    await userEvent.click(secondaryButton);

    const dialog = await screen.findByRole('dialog');
    const productCard = await within(dialog).findByRole('button', {
      name: /Apple iPhone 13 128GB/,
    });
    await userEvent.click(productCard);
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'สภาพเครื่องเดิมตรงรูป' }));
    await userEvent.click(
      within(dialog).getByRole('checkbox', { name: 'เครื่องใหม่จากสต๊อกสาขานี้ IMEI ตรง' }),
    );
    const confirmButton = within(dialog).getByRole('button', { name: 'ยืนยันเปลี่ยนเครื่อง' });
    expect(confirmButton).not.toBeDisabled();

    await userEvent.click(confirmButton);
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(`/after-sales/${detail.id}/exchange/confirm`, {
        replacementProductId: 'prod-9',
      }),
    );
  });

  it('(q) StepBar หัวข้อของ SAME_MODEL_EXCHANGE = 4 ขั้นตาม STEP_TITLES_BY_OUTCOME ไม่มีเลขซ้ำ', async () => {
    const detail = caseDetail({
      outcome: 'SAME_MODEL_EXCHANGE',
      stage: 'AWAITING_APPROVAL',
      repairTicket: null,
      exchange: sameModelExchange(),
    });
    mockGet(detail);
    renderPage(detail.id);

    await screen.findByRole('heading', { name: detail.caseNumber });
    for (const title of ['รับเรื่องแล้ว', 'รอ ผจก. ยืนยัน', 'ส่งมอบเครื่องใหม่', 'ปิดเคส']) {
      const el = screen.getByText(title);
      expect(el.textContent).toBe(title);
    }
  });

  it('P-B: URL ?action=confirm เปิด ConfirmExchangeDialog อัตโนมัติเมื่อเคสอยู่ AWAITING_APPROVAL และ role ยืนยันได้ (ลิงก์จากแท็บรออนุมัติ)', async () => {
    const detail = caseDetail({
      outcome: 'SAME_MODEL_EXCHANGE',
      stage: 'AWAITING_APPROVAL',
      repairTicket: null,
      exchange: sameModelExchange(),
    });
    mockGet(detail);
    auth.user = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'branch-1' };
    renderPage(detail.id, '?action=confirm');

    // เคสนี้เปิด dialog เองตั้งแต่โหลดเสร็จ (radix ตั้ง aria-hidden ให้เนื้อหาหลังฉาก) — รอที่
    // dialog โดยตรงแทนการรอ heading ซึ่งจะถูกซ่อนจาก a11y tree ไปแล้ว
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'ยืนยันเปลี่ยนเครื่อง' }),
    ).toBeInTheDocument();
  });

  it('P-B: URL ?action=approve เปิด ApprovePricedDialog อัตโนมัติเมื่อ role อนุมัติได้; role ไม่พอ (SALES) → ไม่เปิด', async () => {
    const detail = caseDetail({
      outcome: 'PRICED_EXCHANGE',
      stage: 'AWAITING_APPROVAL',
      repairTicket: null,
      exchange: pricedExchange(),
    });
    mockGet(detail);
    auth.user = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'branch-1' };
    const bmRender = renderPage(detail.id, '?action=approve');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    bmRender.unmount();

    auth.user = { id: 'u-sales', role: 'SALES', branchId: 'branch-1' };
    renderPage(detail.id, '?action=approve');
    await screen.findByRole('heading', { name: detail.caseNumber });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
