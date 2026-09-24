import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AfterSalesPage from './AfterSalesPage';
import {
  afterSalesKeys,
  type CaseRow,
  type ListResponse,
  type LookupResult,
  type Summary,
} from './after-sales/after-sales';

const auth = vi.hoisted(() => ({
  user: { id: 'u1', role: 'OWNER', branchId: null as string | null },
}));
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), navigate: vi.fn() }));

vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post },
  getErrorMessage: (error: Error) => error.message,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));
// Task 12 (o) — ปุ่ม "ยืนยันเปลี่ยนเครื่อง"/"เปิดเคส" ในแท็บรออนุมัติ navigate ออกจากหน้านี้
// (ไม่เปิด dialog ในตัว) — mock useNavigate ตาม pattern ของ CrmPipelinePage.test.tsx
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mocks.navigate };
});

const BRANCHES = [{ id: 'branch-1', name: 'ลาดพร้าว' }];

function caseRow(over: Partial<CaseRow> = {}): CaseRow {
  return {
    id: 'case-1',
    caseNumber: 'AS-20260908-0001',
    source: 'INSTALLMENT_CONTRACT',
    outcome: 'REPAIR',
    stage: 'IN_REPAIR',
    stale: false,
    daysInStage: 1,
    receivedAt: '2026-09-08T03:00:00.000Z',
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
    },
    exchange: null,
    ...over,
  };
}

function summary(over: Partial<Summary> = {}): Summary {
  return {
    open: 7,
    openRepair: 6,
    openExchange: 0,
    stale: 1,
    awaitingApproval: 2,
    repairCostShop: 1500,
    repairCostCustomer: 800,
    supplierClaims: 1,
    exchanges: 0,
    ...over,
  };
}

function listResponse(over: Partial<ListResponse> = {}): ListResponse {
  return {
    data: [
      caseRow({ id: 'case-1', stage: 'IN_REPAIR', stale: true, daysInStage: 16 }),
      caseRow({
        id: 'case-2',
        caseNumber: 'AS-20260920-0002',
        stage: 'RECEIVED',
        stale: false,
        daysInStage: 1,
        customer: { id: 'cust-2', name: 'คุณสมชาย ตาราง', phone: '0898765432' },
        repairTicket: {
          id: 'rt-2',
          ticketNumber: 'RT-20260920-0002',
          status: 'OPEN',
          payer: 'SHOP',
          estimatedCost: null,
          actualCost: null,
          sentToRepairAt: null,
          repairedAt: null,
        },
      }),
    ],
    total: 2,
    page: 1,
    limit: 50,
    truncated: false,
    summary: summary(),
    ...over,
  };
}

function mockGet(overrides: { list?: ListResponse; lookup?: LookupResult } = {}) {
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/after-sales') return { data: overrides.list ?? listResponse() };
    if (url === '/branches') return { data: BRANCHES };
    if (url === '/after-sales/lookup') return { data: overrides.lookup };
    throw new Error(`unexpected GET ${url}`);
  });
}

function renderPage(initialEntries: string[] = ['/after-sales']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <AfterSalesPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...utils, client };
}

const foundResult = (over: Partial<LookupResult> = {}): LookupResult => ({
  found: true,
  source: 'INSTALLMENT_CONTRACT',
  product: {
    id: 'p1',
    brand: 'Apple',
    model: 'iPhone 13',
    storage: '128GB',
    imeiSerial: '359123456789012',
  },
  customer: { id: 'c1', name: 'คุณสมชาย เช็คประกัน', phone: '0811112222' },
  contract: { id: 'ct1', contractNumber: 'CT-0001', status: 'ACTIVE' },
  sale: null,
  warranty: {
    status: 'IN_SHOP_WARRANTY',
    daysRemainingIn7Day: 0,
    purchasedAt: '2026-08-01T00:00:00.000Z',
    shopWarrantyEndDate: '2026-12-01T00:00:00.000Z',
    manufacturerWarrantyEndDate: null,
    checkedAt: '2026-09-24T00:00:00.000Z',
  },
  purchasePhotos: {
    front: 'data:x',
    back: 'data:x',
    left: null,
    right: null,
    top: null,
    bottom: null,
  },
  openCase: null,
  outcomes: [{ outcome: 'REPAIR', enabled: true, implemented: true, payerDefault: 'SHOP' }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'u1', role: 'OWNER', branchId: null };
});

describe('AfterSalesPage — หน้าหลัก หลังการขาย (กล่องเช็คประกัน/แจ้งปัญหา · แถบตัวเลข · ตารางเคส)', () => {
  it('เจ้าของเปิดหน้า: เห็นหัว + ปุ่มเช็คประกัน/แจ้งปัญหาเครื่อง + แถบตัวเลข + ป้ายค้างนาน — ไม่มีคำว่า "รับเครื่อง"', async () => {
    mockGet();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'หลังการขาย' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เช็คประกัน' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'แจ้งปัญหาเครื่อง' })).toBeInTheDocument();
    expect(await screen.findByText('7')).toBeInTheDocument(); // เคสเปิดอยู่

    const table = await screen.findByRole('table');
    expect(within(table).getByText('ส่งศูนย์ 16 วัน (เกณฑ์ 14 วัน)')).toBeInTheDocument();

    expect(document.body.textContent).not.toMatch(/รับเครื่อง(?!ไป)/);
  });

  it('พนักงานขาย: useAuth role SALES → ไม่เห็น "ค่าซ่อม" (money null) และไม่มีแท็บ "รออนุมัติ"', async () => {
    auth.user = { id: 'u2', role: 'SALES', branchId: 'branch-1' };
    mockGet({
      list: listResponse({ summary: summary({ repairCostShop: null, repairCostCustomer: null }) }),
    });
    renderPage();

    await screen.findByRole('heading', { name: 'หลังการขาย' });
    expect(await screen.findByText('เคลมศูนย์เดือนนี้')).toBeInTheDocument();
    expect(screen.queryByText(/ค่าซ่อม/)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'กำลังทำ' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'รออนุมัติ' })).not.toBeInTheDocument();
  });

  it('กดเช็คประกัน: พบเครื่อง → การ์ดผลแสดงประกัน/ลูกค้า/ปุ่มต่อเลย · ไม่พบ → ข้อความรับซ่อมได้ (ลูกค้าจ่าย)', async () => {
    mockGet({ lookup: foundResult() });
    renderPage();
    await screen.findByRole('heading', { name: 'หลังการขาย' });

    const input = screen.getByLabelText('เลข IMEI หรือเลขเครื่อง');
    await userEvent.type(input, '359123456789012');
    await userEvent.click(screen.getByRole('button', { name: 'เช็คประกัน' }));

    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith('/after-sales/lookup', {
        params: { imei: '359123456789012' },
      }),
    );
    expect(await screen.findByText('ในประกันร้าน')).toBeInTheDocument();
    expect(screen.getByText('คุณสมชาย เช็คประกัน')).toBeInTheDocument();
    const continueLink = screen.getByRole('link', { name: 'แจ้งปัญหาเครื่อง ต่อเลย' });
    expect(continueLink).toHaveAttribute('href', '/after-sales/new?imei=359123456789012');

    // ไม่พบเครื่องในระบบ
    mockGet({
      lookup: {
        ...foundResult(),
        found: false,
        product: null,
        customer: null,
        contract: null,
        sale: null,
        openCase: null,
      },
    });
    await userEvent.clear(input);
    await userEvent.type(input, '000000000000000');
    await userEvent.click(screen.getByRole('button', { name: 'เช็คประกัน' }));
    expect(
      await screen.findByText('ไม่พบเครื่องในระบบ — รับซ่อมได้ (ลูกค้าจ่าย)'),
    ).toBeInTheDocument();
  });

  it('มี openCase ในผล → แสดง "เครื่องนี้มีเคสที่ยังไม่ปิด AS-…" และปุ่มต่อเลยเปลี่ยนเป็นลิงก์ไปเคสนั้น', async () => {
    mockGet({
      lookup: foundResult({
        openCase: { id: 'case-9', caseNumber: 'AS-20260910-0003', stage: 'IN_REPAIR' },
      }),
    });
    renderPage();
    await screen.findByRole('heading', { name: 'หลังการขาย' });

    const input = screen.getByLabelText('เลข IMEI หรือเลขเครื่อง');
    await userEvent.type(input, '359123456789012');
    await userEvent.click(screen.getByRole('button', { name: 'เช็คประกัน' }));

    expect(
      await screen.findByText(/เครื่องนี้มีเคสที่ยังไม่ปิด AS-20260910-0003/),
    ).toBeInTheDocument();
    const continueLink = screen.getByRole('link', { name: 'แจ้งปัญหาเครื่อง ต่อเลย' });
    expect(continueLink).toHaveAttribute('href', '/after-sales/case-9');
  });

  it('ผจก.สาขา (BRANCH_MANAGER): summary.repairCostShop เป็น null (ไม่ใช่ role เงิน) → ไม่เห็น "ค่าซ่อม" แต่ยังเห็นแท็บ "รออนุมัติ" (อนุมัติได้)', async () => {
    auth.user = { id: 'u3', role: 'BRANCH_MANAGER', branchId: 'branch-1' };
    mockGet({
      list: listResponse({ summary: summary({ repairCostShop: null, repairCostCustomer: null }) }),
    });
    renderPage();

    await screen.findByRole('heading', { name: 'หลังการขาย' });
    expect(await screen.findByText('เคลมศูนย์เดือนนี้')).toBeInTheDocument();
    expect(screen.queryByText(/ค่าซ่อม/)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'รออนุมัติ' })).toBeInTheDocument();
  });

  // C4a (final-fix brief) — ปุ่ม "แจ้งปัญหาเครื่อง" ต้องซ่อนสำหรับ role ที่เปิด /after-sales/new
  // ไม่ได้ (App.tsx: OWNER/BRANCH_MANAGER/SALES เท่านั้น) — เช็คประกันยังใช้ได้ทุก role
  it('C4a: FINANCE_MANAGER (เปิด /after-sales/new ไม่ได้) → ไม่เห็นปุ่ม "แจ้งปัญหาเครื่อง" แต่ยังเห็น "เช็คประกัน"', async () => {
    auth.user = { id: 'u4', role: 'FINANCE_MANAGER', branchId: null };
    mockGet({
      list: listResponse({ summary: summary({ repairCostShop: 1500, repairCostCustomer: 800 }) }),
    });
    renderPage();

    await screen.findByRole('heading', { name: 'หลังการขาย' });
    expect(screen.getByRole('button', { name: 'เช็คประกัน' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'แจ้งปัญหาเครื่อง' })).not.toBeInTheDocument();
  });

  it('C4a: SALES (เปิด /after-sales/new ได้) → ยังเห็นปุ่ม "แจ้งปัญหาเครื่อง"', async () => {
    auth.user = { id: 'u5', role: 'SALES', branchId: 'branch-1' };
    mockGet({
      list: listResponse({ summary: summary({ repairCostShop: null, repairCostCustomer: null }) }),
    });
    renderPage();

    await screen.findByRole('heading', { name: 'หลังการขาย' });
    expect(screen.getByRole('link', { name: 'แจ้งปัญหาเครื่อง' })).toBeInTheDocument();
  });
});

describe('AfterSalesPage — B2/B3 final-fix: pager + ข้อความ truncated', () => {
  function pagedListResponse(over: Partial<ListResponse> = {}): ListResponse {
    return listResponse({ total: 120, page: 1, limit: 50, truncated: false, ...over });
  }

  it('B2: แสดง "หน้า 1 / 3 · ทั้งหมด 120 เคส" และปุ่ม "ก่อนหน้า" ถูก disable ที่หน้าแรก', async () => {
    mockGet({ list: pagedListResponse() });
    renderPage();

    await screen.findByRole('heading', { name: 'หลังการขาย' });
    expect(await screen.findByText('หน้า 1 / 3 · ทั้งหมด 120 เคส')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'หน้าก่อนหน้า' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'หน้าถัดไป' })).not.toBeDisabled();
  });

  it('B2: กด "ถัดไป" → ส่ง page=2 ไปที่ API', async () => {
    mockGet({ list: pagedListResponse() });
    renderPage();

    await screen.findByRole('heading', { name: 'หลังการขาย' });
    await userEvent.click(await screen.findByRole('button', { name: 'หน้าถัดไป' }));

    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        '/after-sales',
        expect.objectContaining({ params: expect.objectContaining({ page: 2 }) }),
      ),
    );
  });

  it('B2: สลับแท็บ → page รีเซ็ตกลับเป็น 1 (แม้เพิ่งอยู่หน้า 2)', async () => {
    mockGet({ list: pagedListResponse() });
    renderPage();

    await screen.findByRole('heading', { name: 'หลังการขาย' });
    await userEvent.click(await screen.findByRole('button', { name: 'หน้าถัดไป' }));
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        '/after-sales',
        expect.objectContaining({ params: expect.objectContaining({ page: 2 }) }),
      ),
    );

    mocks.get.mockClear();
    await userEvent.click(screen.getByRole('tab', { name: 'เสร็จแล้ว' }));

    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        '/after-sales',
        expect.objectContaining({ params: expect.objectContaining({ page: 1, tab: 'DONE' }) }),
      ),
    );
  });

  it('B3: total เกิน 500 (truncated) → Y = ceil(500/limit) และข้อความ truncated บอกความจริง', async () => {
    mockGet({ list: pagedListResponse({ total: 600, truncated: true }) });
    renderPage();

    await screen.findByRole('heading', { name: 'หลังการขาย' });
    expect(await screen.findByText('หน้า 1 / 10 · ทั้งหมด 600 เคส')).toBeInTheDocument();
    expect(
      screen.getByText('แสดงได้สูงสุด 500 เคสล่าสุดในแท็บนี้ — ใช้ช่องค้นหาเพื่อหาเคสที่เหลือ'),
    ).toBeInTheDocument();
  });

  // (m) R25 (b) — Pager clamp: ผู้เรียก (AfterSalesPage) ต้อง clamp เอง ไม่ใช่ปล่อยให้ Pager
  // แสดงเลขหน้าที่เกินจริงเมื่อข้อมูลหด (ตัวกรอง/ข้อมูลเปลี่ยนจนเหลือหน้าน้อยกว่าหน้าที่เคยอยู่)
  it('(m) อยู่หน้า 3 (total 120 → 3 หน้า) แล้ว refetch ได้ total 60 (เหลือ 2 หน้า) → แสดง "หน้า 2 / 2" ไม่ใช่ 3/2', async () => {
    mockGet({ list: pagedListResponse({ page: 3 }) });
    const { client } = renderPage();

    await screen.findByRole('heading', { name: 'หลังการขาย' });
    await screen.findByText('หน้า 1 / 3 · ทั้งหมด 120 เคส');

    await userEvent.click(await screen.findByRole('button', { name: 'หน้าถัดไป' }));
    await screen.findByText('หน้า 2 / 3 · ทั้งหมด 120 เคส');

    await userEvent.click(await screen.findByRole('button', { name: 'หน้าถัดไป' }));
    await screen.findByText('หน้า 3 / 3 · ทั้งหมด 120 เคส');

    // ข้อมูลจริงหดเหลือ 60 (เช่นเคสถูกปิดไปหลายใบ) โดยไม่มีใครกดเปลี่ยนตัวกรอง — บังคับ refetch ตรงๆ
    mockGet({ list: pagedListResponse({ total: 60 }) });
    await client.refetchQueries({ queryKey: afterSalesKeys.all });

    expect(await screen.findByText('หน้า 2 / 2 · ทั้งหมด 60 เคส')).toBeInTheDocument();
  });

  // (n) R25 (c) — reset ครั้งเดียว: สลับแท็บต้องยิง request เดียว (page:1 มาพร้อมกันใน setFilters
  // เดียวกัน) ไม่ใช่สองครั้ง (ครั้งแรกด้วยเพจเก่า + ครั้งที่สองหลัง useEffect รีเซ็ตเพจแบบเดิม)
  it('(n) เปลี่ยนแท็บ → มี request เดียวไปที่ /after-sales และ page เป็น 1 (ไม่มี request ซ้ำจากการรีเซ็ตเพจ)', async () => {
    mockGet({ list: pagedListResponse() });
    renderPage();

    await screen.findByRole('heading', { name: 'หลังการขาย' });
    await userEvent.click(await screen.findByRole('button', { name: 'หน้าถัดไป' }));
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        '/after-sales',
        expect.objectContaining({ params: expect.objectContaining({ page: 2 }) }),
      ),
    );

    mocks.get.mockClear();
    await userEvent.click(screen.getByRole('tab', { name: 'เสร็จแล้ว' }));

    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        '/after-sales',
        expect.objectContaining({ params: expect.objectContaining({ page: 1, tab: 'DONE' }) }),
      ),
    );
    const afterSalesCalls = mocks.get.mock.calls.filter(([url]) => url === '/after-sales');
    expect(afterSalesCalls).toHaveLength(1);
  });
});

describe('AfterSalesPage — Task 12: แท็บรออนุมัติ (ApprovalTable) + ชิป "รอ ผจก." + ?tab=', () => {
  function memoApprovalRow(over: Partial<CaseRow> = {}): CaseRow {
    return caseRow({
      id: 'case-memo',
      caseNumber: 'AS-20260920-0010',
      outcome: 'PRICED_EXCHANGE',
      stage: 'AWAITING_APPROVAL',
      exchange: {
        kind: 'PRICED',
        mode: 'MEMO',
        approvalTier: 'AUTO',
        requestStatus: 'PENDING',
        buybackPrice: null,
        ncvSnapshot: null,
        approverRole: 'BRANCH_MANAGER',
        oldProduct: {
          brand: 'Apple',
          model: 'iPhone 13',
          storage: '128GB',
          imeiSerial: 'IMEI-OLD',
        },
        newProduct: {
          id: 'p2',
          brand: 'Apple',
          model: 'iPhone 13',
          storage: '128GB',
          imeiSerial: 'IMEI-NEW',
        },
        replacementContract: null,
        requestedBy: { id: 'user-1', name: 'ธนา' },
      },
      ...over,
    });
  }

  function sameModelApprovalRow(over: Partial<CaseRow> = {}): CaseRow {
    return caseRow({
      id: 'case-swap',
      caseNumber: 'AS-20260920-0011',
      outcome: 'SAME_MODEL_EXCHANGE',
      stage: 'AWAITING_APPROVAL',
      exchange: {
        kind: 'SAME_MODEL',
        mode: null,
        approvalTier: null,
        requestStatus: null,
        buybackPrice: null,
        ncvSnapshot: null,
        approverRole: 'BRANCH_MANAGER',
        oldProduct: { brand: 'Samsung', model: 'A55', storage: '128GB', imeiSerial: 'IMEI-OLD-2' },
        newProduct: {
          id: 'p3',
          brand: 'Samsung',
          model: 'A55',
          storage: '128GB',
          imeiSerial: 'IMEI-NEW-2',
        },
        replacementContract: null,
        requestedBy: { id: 'user-2', name: 'นิภา' },
      },
      ...over,
    });
  }

  it('(o) แท็บรออนุมัติ render ApprovalTable ไม่ใช่ CaseTable; กด "อนุมัติ" แถว MEMO → dialog checkbox → POST /approve; กด "ยืนยันเปลี่ยนเครื่อง" → navigate ?action=confirm', async () => {
    auth.user = { id: 'u1', role: 'BRANCH_MANAGER', branchId: 'branch-1' };
    mockGet({
      list: listResponse({ data: [memoApprovalRow(), sameModelApprovalRow()], summary: summary() }),
    });
    mocks.post.mockResolvedValue({ data: {} });
    renderPage();

    await userEvent.click(await screen.findByRole('tab', { name: 'รออนุมัติ' }));

    // ApprovalTable มีหัวคอลัมน์เฉพาะของมัน (CaseTable ไม่มี "ใครอนุมัติได้"/มี "ขั้นตอนตอนนี้")
    expect(await screen.findByText('ใครอนุมัติได้')).toBeInTheDocument();
    expect(screen.queryByText('ขั้นตอนตอนนี้')).not.toBeInTheDocument();

    const table = screen.getByRole('table');
    const memoRow = within(table).getByText('AS-20260920-0010').closest('tr');
    if (!memoRow) throw new Error('memo row not found');
    await userEvent.click(within(memoRow).getByRole('button', { name: 'อนุมัติ' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'เซ็น ADDENDUM แล้ว' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'สลับ MDM แล้ว' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'อนุมัติ' }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/after-sales/case-memo/approve', {
        memoAddendumSigned: true,
        memoMdmSwapped: true,
      }),
    );

    const swapRow = within(table).getByText('AS-20260920-0011').closest('tr');
    if (!swapRow) throw new Error('swap row not found');
    await userEvent.click(within(swapRow).getByRole('button', { name: 'ยืนยันเปลี่ยนเครื่อง' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/after-sales/case-swap?action=confirm');
  });

  it('(p) SALES ในแท็บกำลังทำเห็นชิป "รอ ผจก." บนแถว SAME_MODEL ที่กำลังรออนุมัติ', async () => {
    auth.user = { id: 'u2', role: 'SALES', branchId: 'branch-1' };
    mockGet({
      list: listResponse({
        data: [sameModelApprovalRow()],
        summary: summary({ repairCostShop: null, repairCostCustomer: null }),
      }),
    });
    renderPage();

    await screen.findByRole('heading', { name: 'หลังการขาย' });
    expect(screen.queryByRole('tab', { name: 'รออนุมัติ' })).not.toBeInTheDocument();
    // desktop table + มือถือ card เรนเดอร์ทั้งคู่ในเครื่องมือทดสอบ (ซ่อนกันด้วย CSS ไม่ใช่ DOM)
    expect((await screen.findAllByText('รอ ผจก.')).length).toBeGreaterThan(0);
  });

  it('?tab=AWAITING_APPROVAL ตอนโหลดครั้งแรก (role เห็นแท็บนี้) → ตั้งต้นแท็บรออนุมัติด้วย request เดียว (ไม่มี request ซ้ำ)', async () => {
    auth.user = { id: 'u3', role: 'OWNER', branchId: null };
    mockGet({ list: listResponse({ data: [memoApprovalRow()], summary: summary() }) });
    renderPage(['/after-sales?tab=AWAITING_APPROVAL']);

    await screen.findByRole('heading', { name: 'หลังการขาย' });
    expect(screen.getByRole('tab', { name: 'รออนุมัติ' })).toHaveAttribute('aria-selected', 'true');

    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        '/after-sales',
        expect.objectContaining({ params: expect.objectContaining({ tab: 'AWAITING_APPROVAL' }) }),
      ),
    );
    const afterSalesCalls = mocks.get.mock.calls.filter(([url]) => url === '/after-sales');
    expect(afterSalesCalls).toHaveLength(1);
  });

  it('?tab=AWAITING_APPROVAL แต่ role SALES ไม่เห็นแท็บนี้ → ตกกลับเป็น "กำลังทำ" (ACTIVE)', async () => {
    auth.user = { id: 'u4', role: 'SALES', branchId: 'branch-1' };
    mockGet({ list: listResponse() });
    renderPage(['/after-sales?tab=AWAITING_APPROVAL']);

    await screen.findByRole('heading', { name: 'หลังการขาย' });
    expect(screen.getByRole('tab', { name: 'กำลังทำ' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        '/after-sales',
        expect.objectContaining({ params: expect.objectContaining({ tab: 'ACTIVE' }) }),
      ),
    );
  });
});
