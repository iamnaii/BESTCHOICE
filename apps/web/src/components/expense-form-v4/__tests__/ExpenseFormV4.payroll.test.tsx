import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Payroll D4 ส่วนที่ 1 (Task 7) — ฟอร์มใบเงินเดือน: ปุ่ม "บันทึกร่าง + คิดยอด", แถวระบบอ่านอย่างเดียว,
 * payload ไม่มีแถวระบบ (R6), ติ๊ก "รายการปรับปรุงงวดก่อน", เอาแถว OT ที่กรอกเองออกบนบรรทัดที่ระบบคิดให้,
 * และส่งขออนุมัติก่อนเวลาปิดงวด
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
vi.mock('@/lib/api', () => ({
  default: {
    get: (...a: unknown[]) => apiGet(...a),
    post: (...a: unknown[]) => apiPost(...a),
    patch: (...a: unknown[]) => apiPatch(...a),
  },
  getErrorMessage: (e: { response?: { data?: { message?: string } } }) => e?.response?.data?.message ?? 'ผิดพลาด',
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'me', name: 'ผู้ทดสอบ', role: 'OWNER', branchId: 'b1', defaultCashAccountCode: '11-1101' },
  }),
}));
vi.mock('@/hooks/useAccountingPermissions', () => ({
  useAccountingPermissions: () => ({ can: () => true, isError: false, isPending: false, refetch: vi.fn() }),
}));
const flags = vi.hoisted(() => ({ approvalEnabled: false, approvalRequiredDocTypes: [] as string[] }));
vi.mock('@/hooks/useUiFlags', () => ({
  useUiFlags: () => ({
    smartDoctypeSwitchEnabled: false,
    smartSwitchThresholdDays: 0,
    pettyCashEnabled: false,
    templatesEnabled: false,
    taxExemptWarningEnabled: true,
    approvalThreshold: 1000,
    ...flags,
  }),
}));
vi.mock('@/lib/api/ssoConfig', () => ({
  ssoConfigKeys: { effective: (d: string) => ['sso-config', 'effective', d] },
  ssoConfigApi: {
    effective: vi.fn().mockResolvedValue({ salaryCeiling: '17500', maxContribution: '875', effectiveFrom: '2026-01-01', rate: 0.05 }),
  },
}));
// ตัวเลือกพนักงานจริงต้องค้น server — แทนด้วยปุ่มที่เลือกพนักงานคนเดียว
vi.mock('@/components/employees/EmployeeCombobox', () => ({
  default: ({ value, onSelect }: { value: string; onSelect: (e: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({ userId: 'u1', employeeId: 'EMP-1', name: 'สมศรี มีสุข', nickname: null, baseSalary: '15000', ssoEligible: false })
      }
    >
      {value || 'เลือกพนักงาน'}
    </button>
  ),
}));

import { ExpenseFormV4 } from '../ExpenseFormV4';

const STRIP_TOAST = 'เอาแถว OT ที่กรอกเองออก — ระบบคิดจากลงเวลาให้แล้ว';
const CUTOFF_MESSAGE =
  'ส่งขออนุมัติได้ตั้งแต่ 1 พ.ย. 2569 18:00 — รอให้ข้อมูลลงเวลาของเดือนนี้ครบก่อน ระหว่างนี้บันทึกร่างไว้ได้';

const income = (over: Record<string, unknown>) => ({
  isTaxable: true,
  quantity: null,
  rate: null,
  multiplier: null,
  ...over,
});

const ELIGIBLE_LINE = {
  userId: 'u1',
  employeeName: 'สมศรี มีสุข',
  baseSalary: '15000',
  ssoEmployee: '750',
  whtAmount: '0',
  customIncome: [
    income({ accountCode: 'S52-1204', name: 'เบี้ยขยัน', amount: '500', source: 'MANUAL' }),
    income({ accountCode: 'S52-1202', name: 'OT ก.ย. ที่จ่ายขาด', amount: '200', source: 'ADJUSTMENT' }),
    income({
      accountCode: 'S52-1202',
      name: 'OT วันทำงาน (1.5 เท่า)',
      amount: '609.38',
      source: 'ATTENDANCE_OT',
      quantity: '6.5',
      rate: '93.75',
      multiplier: '1.5',
    }),
  ],
  customDeduction: [],
  attendanceSummary: {
    workDays: 25, lateCount: 2, lateMinutes: 18, absent: 0, leave: 1,
    otHours: '6.5', holidayHours: '0.0', holidayOtHours: '0.0', holidayWorkedDays: 0,
    reviewCount: 1, autoOtEligible: true,
  },
  systemNotes: {
    review: [{ dayId: 'd-21', date: '2026-10-21', branchId: 'b1', flags: ['DEVICE_CONFLICT'], blocking: true }],
    warnings: [],
  },
};

const DAILY_LINE = {
  userId: 'u2',
  employeeName: 'กมล แสงทอง',
  baseSalary: '9000',
  ssoEmployee: '450',
  whtAmount: '0',
  customIncome: [income({ accountCode: 'S52-1202', name: 'OT ที่กรอกเอง', amount: '400', source: 'MANUAL' })],
  customDeduction: [],
  attendanceSummary: { ...ELIGIBLE_LINE.attendanceSummary, reviewCount: 0, autoOtEligible: false },
  systemNotes: { review: [], warnings: [{ code: 'NOT_MONTHLY_OR_NO_BASE', otHours: '4.0' }] },
};

const storedDoc = (id: string, lines: unknown[], status = 'DRAFT') => ({
  id,
  number: 'PR-20261101-0001',
  documentType: 'PAYROLL',
  status,
  branchId: 'b1',
  documentDate: '2026-11-02T00:00:00.000Z',
  depositAccountCode: 'S11-1202',
  description: null,
  note: null,
  reference: null,
  payroll: { entityScope: 'SHOP', payrollPeriod: '2026-10', lines },
  payrollGate: null,
});

let docs: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  flags.approvalEnabled = false;
  flags.approvalRequiredDocTypes = [];
  docs = { 'doc-1': storedDoc('doc-1', [ELIGIBLE_LINE]) };
  apiGet.mockImplementation((path: string) => {
    if (path.startsWith('/expense-documents/payroll/meta')) {
      return Promise.resolve({
        data: {
          scope: 'SHOP',
          incomeWhitelist: [
            { code: 'S52-1202', name: 'ค่าล่วงเวลา (OT)' },
            { code: 'S52-1204', name: 'โบนัส' },
          ],
          cashAccounts: [],
          attendanceAccountCodes: ['S52-1202'],
        },
      });
    }
    const m = path.match(/^\/expense-documents\/([^/?]+)$/);
    if (m && docs[m[1]]) return Promise.resolve({ data: docs[m[1]] });
    return Promise.resolve({ data: [] });
  });
  apiPatch.mockImplementation((path: string) => Promise.resolve({ data: { id: path.split('/')[2] } }));
  apiPost.mockImplementation((path: string) => {
    if (path === '/expense-documents/payroll') return Promise.resolve({ data: { id: 'new-1' } });
    return Promise.resolve({ data: {} });
  });
});

function mount(props: { editDocId?: string } = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ExpenseFormV4 branchId="b1" initialDocType="PAYROLL" onSaved={onSaved} onClose={onClose} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onSaved, onClose };
}

const patchedLines = (call = -1) =>
  (apiPatch.mock.calls.at(call)?.[1] as { lines: Array<{ customIncome?: Array<Record<string, unknown>> }> }).lines;

const expandFirstLine = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click((await screen.findAllByRole('button', { name: 'ขยาย' }))[0]);

describe('ExpenseFormV4 payroll — editing a computed draft (R6)', () => {
  it('re-saving drops stored ATTENDANCE_* rows and keeps ADJUSTMENT rows as adjustments', async () => {
    const user = userEvent.setup();
    const { onSaved } = mount({ editDocId: 'doc-1' });
    await screen.findByRole('button', { name: 'สมศรี มีสุข' });
    await user.click(screen.getByRole('button', { name: 'บันทึกร่าง' }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    expect(apiPatch.mock.calls[0][0]).toBe('/expense-documents/doc-1/payroll');
    expect(patchedLines()[0].customIncome).toEqual([
      { accountCode: 'S52-1204', name: 'เบี้ยขยัน', amount: 500, isTaxable: true },
      { accountCode: 'S52-1202', name: 'OT ก.ย. ที่จ่ายขาด', amount: 200, isTaxable: true, isAdjustment: true },
    ]);
    expect(toast.info).not.toHaveBeenCalledWith(STRIP_TOAST);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('opens a PENDING_APPROVAL payroll for editing and says saving sends it back to draft', async () => {
    docs['doc-1'] = storedDoc('doc-1', [ELIGIBLE_LINE], 'PENDING_APPROVAL');
    mount({ editDocId: 'doc-1' });
    expect(await screen.findByRole('button', { name: 'สมศรี มีสุข' })).toBeInTheDocument();
    expect(screen.getByText(/บันทึกแล้วใบจะกลับเป็นร่าง/)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('refuses to open a POSTED payroll', async () => {
    docs['doc-1'] = storedDoc('doc-1', [ELIGIBLE_LINE], 'POSTED');
    const { onClose } = mount({ editDocId: 'doc-1' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('ExpenseFormV4 payroll — บันทึกร่าง + คิดยอด', () => {
  it('creates the draft, reloads it with locked system rows + review panel, and the next save PATCHes it', async () => {
    const user = userEvent.setup();
    const { onSaved } = mount();
    await user.click(await screen.findByRole('button', { name: 'เลือกพนักงาน' }));
    docs['new-1'] = storedDoc('new-1', [ELIGIBLE_LINE]);
    await user.click(screen.getByRole('button', { name: 'บันทึกร่าง + คิดยอด' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/expense-documents/payroll', expect.anything()));
    const created = apiPost.mock.calls.find((c) => c[0] === '/expense-documents/payroll')![1] as {
      branchId: string;
      lines: Array<{ userId: string; customIncome?: unknown }>;
    };
    expect(created.branchId).toBe('b1');
    expect(created.lines).toEqual([expect.objectContaining({ userId: 'u1', baseSalary: 15000 })]);
    expect(created.lines[0].customIncome).toBeUndefined();

    // ใบที่บันทึกแล้วถูกโหลดกลับ — แผงตรวจจาก systemNotes ที่เก็บไว้
    expect(await screen.findByRole('heading', { name: 'วันที่ต้องตรวจ (1)' })).toBeInTheDocument();
    expect(screen.getByText('เครื่องถูกใช้ซ้อน')).toBeInTheDocument();
    expect(screen.getByText('ระบบคิด OT ใหม่ทุกครั้งที่บันทึก')).toBeInTheDocument();

    await expandFirstLine(user);
    const locked = screen.getByRole('region', { name: 'รายได้จากระบบ — แก้ในใบนี้ไม่ได้' });
    expect(within(locked).getByText('OT วันทำงาน (1.5 เท่า)')).toBeInTheDocument();
    expect(within(locked).getByText('6.5 × 93.75')).toBeInTheDocument();
    expect(within(locked).getByText('609.38')).toBeInTheDocument();
    expect(within(locked).getByText('จากระบบลงเวลา')).toBeInTheDocument();
    for (const role of ['textbox', 'spinbutton', 'checkbox', 'combobox'] as const) {
      expect(within(locked).queryAllByRole(role)).toHaveLength(0);
    }
    expect(screen.getByText('สรุปลงเวลา ต.ค. 2569 — ข้อมูลประกอบ ไม่หักเงิน')).toBeInTheDocument();

    // ยังอยู่ในโหมดแก้ไขของร่างนั้น: บันทึกครั้งถัดไปเป็น PATCH ไม่ใช่สร้างซ้ำ
    await user.click(screen.getByRole('button', { name: 'บันทึกร่าง + คิดยอด' }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    expect(apiPatch.mock.calls[0][0]).toBe('/expense-documents/new-1/payroll');
    // payload ไม่มีแถวระบบ — เฉพาะแถวที่คนกรอก + รายการปรับปรุงงวดก่อน
    expect(patchedLines()[0].customIncome).toEqual([
      { accountCode: 'S52-1204', name: 'เบี้ยขยัน', amount: 500, isTaxable: true },
      { accountCode: 'S52-1202', name: 'OT ก.ย. ที่จ่ายขาด', amount: 200, isTaxable: true, isAdjustment: true },
    ]);
    expect(apiPost.mock.calls.filter((c) => c[0] === '/expense-documents/payroll')).toHaveLength(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('shows the column รายได้พิเศษ with system + typed income', async () => {
    mount({ editDocId: 'doc-1' });
    expect(await screen.findByRole('columnheader', { name: 'รายได้พิเศษ' })).toBeInTheDocument();
    // 500 + 200 + 609.38
    expect(screen.getAllByText('1,309.38').length).toBeGreaterThan(0);
  });
});

describe('ExpenseFormV4 payroll — typed income rows', () => {
  it('the รายการปรับปรุงงวดก่อน checkbox sends isAdjustment and the row is not stripped', async () => {
    const user = userEvent.setup();
    mount({ editDocId: 'doc-1' });
    await screen.findByRole('button', { name: 'สมศรี มีสุข' });
    await expandFirstLine(user);
    await user.click(screen.getByRole('button', { name: /เพิ่มรายได้พิเศษ/ }));
    const amounts = screen.getAllByRole('spinbutton', { name: 'จำนวนเงิน' });
    await user.type(amounts[amounts.length - 1], '300');
    const ticks = screen.getAllByRole('checkbox', { name: 'รายการปรับปรุงงวดก่อน' });
    await user.click(ticks[ticks.length - 1]);
    await user.click(screen.getByRole('button', { name: 'บันทึกร่าง' }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    expect(patchedLines()[0].customIncome).toContainEqual(
      expect.objectContaining({ accountCode: 'S52-1202', amount: 300, isAdjustment: true }),
    );
    expect(toast.info).not.toHaveBeenCalledWith(STRIP_TOAST);
  });

  it('strips a typed OT row on a saved eligible line before saving, with a toast', async () => {
    const user = userEvent.setup();
    mount({ editDocId: 'doc-1' });
    await screen.findByRole('button', { name: 'สมศรี มีสุข' });
    await expandFirstLine(user);
    await user.click(screen.getByRole('button', { name: /เพิ่มรายได้พิเศษ/ }));
    const amounts = screen.getAllByRole('spinbutton', { name: 'จำนวนเงิน' });
    await user.type(amounts[amounts.length - 1], '450');
    await user.click(screen.getByRole('button', { name: 'บันทึกร่าง' }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    expect(toast.info).toHaveBeenCalledWith(STRIP_TOAST);
    expect(patchedLines()[0].customIncome).not.toContainEqual(expect.objectContaining({ amount: 450 }));
    // รายการปรับปรุงงวดก่อน (รหัส OT เดียวกัน) ไม่ถูกเอาออก
    expect(patchedLines()[0].customIncome).toContainEqual(expect.objectContaining({ amount: 200, isAdjustment: true }));
  });

  it("keeps and sends a DAILY line's typed S52-1202 row", async () => {
    const user = userEvent.setup();
    docs['doc-1'] = storedDoc('doc-1', [DAILY_LINE]);
    mount({ editDocId: 'doc-1' });
    await screen.findByRole('button', { name: 'กมล แสงทอง' });
    await user.click(screen.getByRole('button', { name: 'บันทึกร่าง' }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    expect(patchedLines()[0].customIncome).toEqual([
      { accountCode: 'S52-1202', name: 'OT ที่กรอกเอง', amount: 400, isTaxable: true },
    ]);
    expect(toast.info).not.toHaveBeenCalledWith(STRIP_TOAST);
  });

  it('leaves a never-saved line to the server and shows MANUAL_OT_DUPLICATE inline', async () => {
    const user = userEvent.setup();
    const duplicate = 'สมศรี มีสุข มีแถว OT ที่กรอกเองซ้ำกับ OT จากระบบลงเวลา — ลบแถวนั้น หรือติ๊ก "รายการปรับปรุงงวดก่อน" ถ้าเป็นการแก้ OT ของเดือนก่อน';
    apiPost.mockRejectedValueOnce({ response: { status: 400, data: { code: 'MANUAL_OT_DUPLICATE', message: duplicate } } });
    const { onSaved } = mount();
    await user.click(await screen.findByRole('button', { name: 'เลือกพนักงาน' }));
    await user.click(screen.getByRole('button', { name: 'ขยาย' }));
    await user.click(screen.getByRole('button', { name: /เพิ่มรายได้พิเศษ/ }));
    await user.type(screen.getByRole('spinbutton', { name: 'จำนวนเงิน' }), '450');
    await user.click(screen.getByRole('button', { name: 'บันทึกร่าง' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(duplicate);
    const sent = apiPost.mock.calls.find((c) => c[0] === '/expense-documents/payroll')![1] as {
      lines: Array<{ customIncome?: unknown[] }>;
    };
    expect(sent.lines[0].customIncome).toEqual([expect.objectContaining({ accountCode: 'S52-1202', amount: 450 })]);
    expect(toast.info).not.toHaveBeenCalledWith(STRIP_TOAST);
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('ExpenseFormV4 payroll — save and submit before the cutoff', () => {
  it('shows the SUBMIT_CUTOFF message and keeps the saved draft open in edit mode', async () => {
    flags.approvalEnabled = true;
    flags.approvalRequiredDocTypes = ['PAYROLL'];
    const user = userEvent.setup();
    apiPost.mockImplementation((path: string) => {
      if (path === '/expense-documents/payroll') return Promise.resolve({ data: { id: 'new-1' } });
      if (path === '/expense-documents/new-1/submit-for-approval') {
        return Promise.reject({
          response: {
            status: 409,
            data: { code: 'PAYROLL_SUBMIT_CUTOFF', closableAt: '2026-11-01T11:00:00.000Z', message: CUTOFF_MESSAGE },
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
    const { onSaved } = mount();
    await user.click(await screen.findByRole('button', { name: 'เลือกพนักงาน' }));
    docs['new-1'] = storedDoc('new-1', [ELIGIBLE_LINE]);
    await user.click(screen.getByRole('button', { name: 'บันทึกและขออนุมัติ' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(CUTOFF_MESSAGE);
    expect(onSaved).not.toHaveBeenCalled();
    // ใบที่บันทึกแล้วยังเป็นร่าง — กดบันทึกอีกครั้งแก้ใบเดิม ไม่สร้างใบซ้ำ
    await user.click(screen.getByRole('button', { name: 'บันทึกร่าง + คิดยอด' }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/expense-documents/new-1/payroll', expect.anything()));
    expect(apiPost.mock.calls.filter((c) => c[0] === '/expense-documents/payroll')).toHaveLength(1);
  });
});
