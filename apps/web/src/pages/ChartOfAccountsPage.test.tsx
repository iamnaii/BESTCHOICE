import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChartOfAccountsPage from './ChartOfAccountsPage';

/**
 * แท็บ FINANCE | SHOP บนหน้าผังบัญชี (เจ้าของเลือกทาง ก, 2026-08-07) —
 * review W2: ทดสอบ wiring จริงของหน้า (สลับแท็บ → กรอง/จัดหมวด, กันสร้างผิดฝั่ง)
 * ไม่ใช่แค่ pure helpers (coa-partition.test.ts).
 */

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  default: apiMock,
  getErrorMessage: (e: unknown) => String(e),
}));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const ACCOUNTS = [
  { id: 'a1', code: '11-1101', name: 'เงินสด — สุทธินีย์ คงเดช', type: 'สินทรัพย์', normalBalance: 'Dr', category: 'เงินสด', vatApplicable: false, notes: null, status: 'ใช้งาน' },
  { id: 'a2', code: '53-1101', name: 'เงินเดือน ค่าจ้าง', type: 'ค่าใช้จ่าย', normalBalance: 'Dr', category: null, vatApplicable: false, notes: null, status: 'ใช้งาน' },
  { id: 'a3', code: 'S52-1201', name: 'เงินเดือนพนักงานสาขา', type: 'ค่าใช้จ่าย', normalBalance: 'Dr', category: 'OpEx-บุคลากร', vatApplicable: false, notes: null, status: 'ใช้งาน' },
  { id: 'a4', code: 'S11-1101', name: 'เงินสด - สาขา หน้าร้านกลาง', type: 'สินทรัพย์', normalBalance: 'Dr', category: 'เงินสด', vatApplicable: false, notes: null, status: 'ใช้งาน' },
];

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChartOfAccountsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: ACCOUNTS });
});

describe('ChartOfAccountsPage — แท็บ FINANCE | SHOP', () => {
  it('เปิดมาที่ FINANCE: เห็นเฉพาะรหัสตัวเลข ไม่เห็นรหัส S', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('11-1101')).toBeInTheDocument());
    expect(screen.getByText('53-1101')).toBeInTheDocument();
    expect(screen.queryByText('S52-1201')).not.toBeInTheDocument();
    expect(screen.queryByText('S11-1101')).not.toBeInTheDocument();
  });

  it('สลับแท็บ SHOP: เห็นเฉพาะรหัส S + หัวหมวดถูกต้อง (ไม่ใช่ "หมวด S5" แบบบั๊กเดิม)', async () => {
    const user = userEvent.setup();
    wrap();
    await waitFor(() => expect(screen.getByText('11-1101')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /SHOP \(หน้าร้าน\)/ }));

    expect(screen.getByText('S52-1201')).toBeInTheDocument();
    expect(screen.getByText('S11-1101')).toBeInTheDocument();
    expect(screen.queryByText('11-1101')).not.toBeInTheDocument();
    // หัวหมวดจาก coa-partition — บั๊กเดิมจะขึ้น "หมวด S5"
    expect(screen.getByText('ค่าใช้จ่ายบริหารสาขา (SHOP)')).toBeInTheDocument();
    expect(screen.queryByText(/หมวด S5/)).not.toBeInTheDocument();
  });

  it('กันสร้างบัญชีผิดฝั่ง: แท็บ SHOP + รหัสตัวเลข → toast error, ไม่ยิง POST', async () => {
    const user = userEvent.setup();
    wrap();
    await waitFor(() => expect(screen.getByText('11-1101')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /SHOP \(หน้าร้าน\)/ }));
    await user.click(screen.getByRole('button', { name: /\+ เพิ่มบัญชี/ }));
    await user.type(screen.getByPlaceholderText('เช่น S11-1101'), '42-1199');
    await user.type(screen.getByPlaceholderText('เช่น เงินสด'), 'รายได้อื่นๆ ทั่วไป');
    await user.click(screen.getByRole('button', { name: 'เพิ่มบัญชี' }));

    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('ขึ้นต้นด้วย S'));
    expect(apiMock.post).not.toHaveBeenCalled();
  });
});
