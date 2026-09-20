/**
 * หน้า /repossessions หลังใบรับเครื่องคืน (spec 2026-09-20 §7):
 *   - รายการ "รอยึดเครื่อง" มาจาก GET /device-returns/awaiting-repossession (TERMINATED ที่ยังไม่มีใบค้าง/แถวยึด)
 *     ปุ่มต่อแถวคือ "รับเครื่องคืน" → เปิด DeviceReturnIntakeDialog ล็อกสัญญานั้น
 *   - ปุ่มหัวหน้า "บันทึกรับเครื่องคืน" → เปิด dialog แบบค้นสัญญาเอง (OWNER/BM เท่านั้น)
 *   - ตาราง "ใบรับเครื่องคืน — รอ FINANCE ยืนยัน" ปุ่ม ยืนยัน → RepossessionOverlay โหมดยืนยัน (deviceReturnId)
 */
import type { ReactNode } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const apiGet = vi.fn();

vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(),
    patch: vi.fn(),
  },
  getErrorMessage: (e: unknown) => String(e),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

type TestUser = { id: string; name: string; role: string; branchId: string | null };
let currentUser: TestUser = { id: 'u-owner', name: 'เจ้าของ', role: 'OWNER', branchId: null };
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, isLoading: false }),
}));

// overlay/dialog ตัวจริงมีเทสต์ของตัวเอง — ที่นี่ดูแค่ว่าหน้าส่ง prop ที่ถูกต้องให้
vi.mock('@/pages/PaymentsPage/components/RepossessionOverlay', () => ({
  RepossessionOverlay: (p: {
    deviceReturnId: string;
    contractNumber: string;
    customerName: string;
  }) => (
    <div data-testid="repo-overlay">
      overlay:{p.deviceReturnId}:{p.contractNumber}:{p.customerName}
    </div>
  ),
}));
vi.mock('@/components/device-returns/DeviceReturnIntakeDialog', () => ({
  DeviceReturnIntakeDialog: (p: { open: boolean; initialContractId?: string }) =>
    p.open ? <div data-testid="intake-dialog">intake:{p.initialContractId ?? 'search'}</div> : null,
}));
vi.mock('@/components/contract/ContractJournalDialog', () => ({ default: () => null }));

import RepossessionsPage from './RepossessionsPage';

const terminatedContract = {
  id: 'c-term-1',
  contractNumber: 'TEST-20260827-021',
  status: 'TERMINATED',
  monthlyPayment: '5371.00',
  customer: { id: 'cu1', name: 'ทดสอบ ยึดเครื่อง (บอกเลิกแล้ว) 21', phone: '0800000000' },
  product: { id: 'p1', name: 'iPhone 15', brand: 'Apple', model: '15' },
  branch: { id: 'b1', name: 'ลาดพร้าว' },
};

const pendingReturn = {
  id: 'dr-1',
  docNumber: 'DR-20260919-0001',
  status: 'PENDING_CONFIRM',
  returnKind: 'VOLUNTARY',
  returnReason: 'UNAFFORDABLE',
  deviceReceivedAt: '2026-09-19T03:00:00.000Z',
  conditionGrade: 'B',
  appraisalPrice: '7000.00',
  tableBasePrice: '6500.00',
  repairCost: '0.00',
  notes: null,
  lineNotifyStatus: 'SENT',
  lineNotifiedAt: '2026-09-19T03:01:00.000Z',
  receivingBranch: { id: 'b1', name: 'ลาดพร้าว' },
  receivedBy: { id: 'u-bm', name: 'ผจก.ลาดพร้าว' },
  contract: {
    id: 'c-ret-1',
    contractNumber: 'TEST-20260919-001',
    status: 'TERMINATED',
    customer: { id: 'cu9', name: 'สมชาย ใจดี' },
    product: { id: 'p9', brand: 'Apple', model: 'iPhone 14', imeiSerial: null },
  },
  confirmedAt: null,
  confirmedBy: null,
  repossessionId: null,
  rejectReason: null,
  createdAt: '2026-09-19T03:00:00.000Z',
};

function routeApi(awaiting: unknown[], pending: unknown[] = []) {
  apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/device-returns/awaiting-repossession')) {
      return Promise.resolve({ data: { data: awaiting, total: awaiting.length } });
    }
    if (url.startsWith('/device-returns?')) {
      return Promise.resolve({
        data: { data: pending, total: pending.length, page: 1, limit: 100 },
      });
    }
    if (url.startsWith('/repossessions/profit-loss')) {
      return Promise.resolve({ data: {} });
    }
    if (url.startsWith('/repossessions')) {
      return Promise.resolve({ data: { data: [], total: 0 } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  currentUser = { id: 'u-owner', name: 'เจ้าของ', role: 'OWNER', branchId: null };
  apiGet.mockReset();
});

describe('RepossessionsPage — รอยึดเครื่อง (GET /device-returns/awaiting-repossession)', () => {
  it('lists awaiting contracts from the device-returns endpoint with a รับเครื่องคืน button', async () => {
    routeApi([terminatedContract]);
    render(<RepossessionsPage />, { wrapper });

    expect(await screen.findByText('TEST-20260827-021')).toBeInTheDocument();
    expect(screen.getByText(/ทดสอบ ยึดเครื่อง \(บอกเลิกแล้ว\) 21/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'รับเครื่องคืน' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^ยึดเครื่อง$/ })).not.toBeInTheDocument();
    expect(
      apiGet.mock.calls.some(([url]) =>
        String(url).startsWith('/device-returns/awaiting-repossession?limit=100'),
      ),
    ).toBe(true);
    expect(apiGet.mock.calls.some(([url]) => String(url).startsWith('/contracts?'))).toBe(false);
  });

  it('รับเครื่องคืน on a row opens the intake dialog locked to that contract', async () => {
    routeApi([terminatedContract]);
    render(<RepossessionsPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: 'รับเครื่องคืน' }));

    expect(screen.getByTestId('intake-dialog')).toHaveTextContent('intake:c-term-1');
  });

  it('header button บันทึกรับเครื่องคืน opens the intake dialog in search mode (OWNER)', async () => {
    routeApi([]);
    render(<RepossessionsPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: 'บันทึกรับเครื่องคืน' }));

    expect(screen.getByTestId('intake-dialog')).toHaveTextContent('intake:search');
  });

  it('FINANCE_MANAGER sees neither the header button nor the row button (POST /device-returns roles)', async () => {
    currentUser = { id: 'u-fm', name: 'ผจก.การเงิน', role: 'FINANCE_MANAGER', branchId: null };
    routeApi([terminatedContract]);
    render(<RepossessionsPage />, { wrapper });

    await screen.findByText('TEST-20260827-021');
    expect(screen.queryByRole('button', { name: 'บันทึกรับเครื่องคืน' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'รับเครื่องคืน' })).not.toBeInTheDocument();
  });

  it('no longer points staff at the payments page to repossess', async () => {
    routeApi([]);
    render(<RepossessionsPage />, { wrapper });

    expect(await screen.findByText(/ไม่มีสัญญาที่บอกเลิกแล้วรอยึดเครื่อง/)).toBeInTheDocument();
    expect(screen.queryByText(/ไปหน้ารับชำระ/)).not.toBeInTheDocument();
  });
});

describe('RepossessionsPage — ใบรับเครื่องคืน รอ FINANCE ยืนยัน', () => {
  it('ยืนยัน on a pending device return opens the overlay in confirm mode with deviceReturnId', async () => {
    routeApi([], [pendingReturn]);
    render(<RepossessionsPage />, { wrapper });

    const row = await screen.findByTestId('device-return-row-DR-20260919-0001');
    fireEvent.click(within(row).getByRole('button', { name: 'ยืนยัน' }));

    expect(screen.getByTestId('repo-overlay')).toHaveTextContent(
      'overlay:dr-1:TEST-20260919-001:สมชาย ใจดี',
    );
  });
});
