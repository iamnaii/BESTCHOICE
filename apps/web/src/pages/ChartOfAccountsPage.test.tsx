import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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
  put: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  default: apiMock,
  getErrorMessage: (e: unknown) => String(e),
}));

let role = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const ACCOUNTS = [
  { id: 'a1', code: '11-1101', name: 'เงินสด — สุทธินีย์ คงเดช', type: 'สินทรัพย์', normalBalance: 'Dr', category: 'เงินสด', vatApplicable: false, notes: null, status: 'ใช้งาน' },
  { id: 'a2', code: '53-1101', name: 'เงินเดือน ค่าจ้าง', type: 'ค่าใช้จ่าย', normalBalance: 'Dr', category: null, vatApplicable: false, notes: null, status: 'ใช้งาน' },
  { id: 'a3', code: 'S52-1201', name: 'เงินเดือนพนักงานสาขา', type: 'ค่าใช้จ่าย', normalBalance: 'Dr', category: 'OpEx-บุคลากร', vatApplicable: false, notes: null, status: 'ใช้งาน' },
  { id: 'a4', code: 'S11-1101', name: 'เงินสด - สาขา หน้าร้านกลาง', type: 'สินทรัพย์', normalBalance: 'Dr', category: 'เงินสด', vatApplicable: false, notes: null, status: 'ใช้งาน' },
];

function wrap(entry = '/settings/accounting/chart') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}><ChartOfAccountsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  role = 'OWNER';
  apiMock.get.mockImplementation(async (path: string) => ({
    data: path === '/chart-of-accounts/peak-mapping' ? ACCOUNTS.map((a) => ({ ...a, peakCode: null })) : ACCOUNTS,
  }));
});

const chart = () => within(screen.getByRole('tabpanel', { name: 'รายการบัญชี' }));

describe('ChartOfAccountsPage — แท็บ FINANCE | SHOP', () => {
  it('เปิดมาที่ FINANCE: เห็นเฉพาะรหัสตัวเลข ไม่เห็นรหัส S', async () => {
    wrap();
    await waitFor(() => expect(chart().getByText('11-1101')).toBeInTheDocument());
    expect(chart().getByText('53-1101')).toBeInTheDocument();
    expect(chart().queryByText('S52-1201')).not.toBeInTheDocument();
    expect(chart().queryByText('S11-1101')).not.toBeInTheDocument();
  });

  it('สลับแท็บ SHOP: เห็นเฉพาะรหัส S + หัวหมวดถูกต้อง (ไม่ใช่ "หมวด S5" แบบบั๊กเดิม)', async () => {
    const user = userEvent.setup();
    wrap();
    await waitFor(() => expect(chart().getByText('11-1101')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /SHOP \(หน้าร้าน\)/ }));

    expect(chart().getByText('S52-1201')).toBeInTheDocument();
    expect(chart().getByText('S11-1101')).toBeInTheDocument();
    expect(chart().queryByText('11-1101')).not.toBeInTheDocument();
    // หัวหมวดจาก coa-partition — บั๊กเดิมจะขึ้น "หมวด S5"
    expect(chart().getByText('ค่าใช้จ่ายบริหารสาขา (SHOP)')).toBeInTheDocument();
    expect(chart().queryByText(/หมวด S5/)).not.toBeInTheDocument();
  });

  it('กันสร้างบัญชีผิดฝั่ง: แท็บ SHOP + รหัสตัวเลข → toast error, ไม่ยิง POST', async () => {
    const user = userEvent.setup();
    wrap();
    await waitFor(() => expect(chart().getByText('11-1101')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /SHOP \(หน้าร้าน\)/ }));
    await user.click(screen.getByRole('button', { name: /\+ เพิ่มบัญชี/ }));
    await user.type(screen.getByPlaceholderText('เช่น S11-1101'), '42-1199');
    await user.type(screen.getByPlaceholderText('เช่น เงินสด'), 'รายได้อื่นๆ ทั่วไป');
    await user.click(screen.getByRole('button', { name: 'เพิ่มบัญชี' }));

    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('ขึ้นต้นด้วย S'));
    expect(apiMock.post).not.toHaveBeenCalled();
  });
});


describe('PEAK mapping inside the chart of accounts', () => {
  it('opens the mapping deep link, preserves unsaved changes across views, and saves them', async () => {
    role = 'ACCOUNTANT';
    const user = userEvent.setup();
    apiMock.put.mockResolvedValue({ data: { updated: 1 } });
    wrap('/settings/accounting/chart?tab=peak');
    const peak = within(screen.getByRole('tabpanel', { name: 'จับคู่รหัส PEAK' }));
    const input = await peak.findByLabelText('รหัส PEAK สำหรับ 11-1101');
    await user.type(input, '1110-01');
    await user.click(screen.getByRole('tab', { name: 'รายการบัญชี' }));
    expect(screen.queryByRole('textbox', { name: 'รหัส PEAK สำหรับ 11-1101' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'จับคู่รหัส PEAK' }));
    expect(input).toHaveValue('1110-01');
    expect(screen.queryByRole('button', { name: /FINANCE \(การเงิน\)/ })).not.toBeInTheDocument();
    await user.click(peak.getByRole('button', { name: /บันทึก/ }));
    await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith('/chart-of-accounts/peak-mapping', {
      mappings: [{ id: 'a1', peakCode: '1110-01' }],
    }));
  });

  it('lets FINANCE_MANAGER read and download mappings without write controls', async () => {
    role = 'FINANCE_MANAGER';
    wrap('/settings/accounting/chart?tab=peak');
    expect(await screen.findByRole('textbox', { name: 'รหัส PEAK สำหรับ 11-1101' })).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'ดาวน์โหลด CSV' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'นำเข้าจาก CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /บันทึก/ })).not.toBeInTheDocument();
    expect(apiMock.put).not.toHaveBeenCalled();
  });
});
