import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AfterSalesPage from './AfterSalesPage';
import type { CaseRow, ListResponse, LookupResult, Summary } from './after-sales/after-sales';

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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AfterSalesPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
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
    expect(within(table).getByText('ส่งศูนย์ 16 วัน (เกิน 14)')).toBeInTheDocument();

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
});
