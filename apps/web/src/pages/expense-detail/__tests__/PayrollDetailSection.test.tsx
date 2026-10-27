import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Payroll D4 ส่วนที่ 1 (Task 8, mockup กระดาน 2 + 6A) — หน้ารายละเอียดใบเงินเดือน: ตารางบรรทัด, วันที่ต้องตรวจ/คำเตือน,
 * ด่านเวลาปิดงวด + วันติดธงเครื่องถูกใช้ซ้อน (`payrollGate`), 409 PAYROLL_STALE, ปุ่ม แก้ไข และปุ่มพิมพ์สลิป
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
  getErrorMessage: (e: { response?: { data?: { message?: string } } }) => e?.response?.data?.message ?? 'ผิดพลาด',
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-1', name: 'เจ้าของ', role: 'OWNER', branchId: 'b1', canReverseOverride: null } }),
}));
vi.mock('@/hooks/useAccountingPermissions', () => ({ useAccountingPermissions: () => ({ can: () => true }) }));
const flags = vi.hoisted(() => ({ approvalEnabled: true }));
vi.mock('@/hooks/useUiFlags', () => ({
  useUiFlags: () => ({ reversePermission: 'OWNER+FINANCE_MANAGER', reverseReasonRequired: false, reverseReasons: [], ...flags }),
}));
vi.mock('@/components/PdfPreview', () => ({ default: () => null }));

import ExpenseDetailPage from '@/pages/ExpenseDetailPage';

const SUBMIT_CUTOFF =
  'ส่งขออนุมัติได้ตั้งแต่ 1 พ.ย. 2569 18:00 — รอให้ข้อมูลลงเวลาของเดือนนี้ครบก่อน ระหว่างนี้บันทึกร่างไว้ได้';
const POST_CUTOFF = 'ลงบัญชีได้ตั้งแต่ 1 พ.ย. 2569 18:00 — รอให้ข้อมูลลงเวลาของเดือนนี้ครบก่อน';
const DEVICE_CONFLICT =
  'อนุมัติไม่ได้ — มีวันที่ติดธง เครื่องถูกใช้ซ้อน 1 วัน (สมศรี มีสุข · 16 ต.ค.) ให้เจ้าของตรวจที่เมนู ลงเวลา แล้วกด "ตรวจแล้ว ล้างธง"';
const STALE =
  'ยังไม่ได้ลงบัญชี — ข้อมูลลงเวลาเปลี่ยนหลังบันทึกใบ ให้ผู้ทำเงินเดือนกด "แก้ไข" แล้วบันทึกใบอีกครั้ง (ระบบคิดยอดใหม่ให้) ตรวจยอด แล้วส่งขออนุมัติอีกครั้ง';
const CLOSABLE_AT = '2026-11-01T11:00:00.000Z';

const income = (over: Record<string, unknown>) => ({
  isTaxable: true,
  quantity: null,
  rate: null,
  multiplier: null,
  source: 'MANUAL',
  ...over,
});

const LINE_SOMSRI = {
  id: 'l1',
  userId: 'u1',
  employeeName: 'สมศรี มีสุข',
  employeeTaxId: null,
  baseSalary: '15000',
  ssoEmployee: '750',
  whtAmount: '0',
  netPaid: '16234.38',
  customIncome: [
    income({ id: 'i1', accountCode: 'S52-1202', name: 'OT วันทำงาน (1.5 เท่า)', amount: '609.38', source: 'ATTENDANCE_OT', quantity: '6.5', rate: '93.75', multiplier: '1.5' }),
    income({ id: 'i2', accountCode: 'S52-1202', name: 'ทำงานวันหยุด (1 เท่า)', amount: '500', source: 'ATTENDANCE_HOLIDAY', quantity: '8', rate: '62.5', multiplier: '1' }),
    income({ id: 'i3', accountCode: 'S52-1202', name: 'OT วันหยุด (3 เท่า)', amount: '375', source: 'ATTENDANCE_HOLIDAY_OT', quantity: '2', rate: '187.5', multiplier: '3' }),
    income({ id: 'i4', accountCode: 'S52-1204', name: 'เบี้ยขยัน', amount: '500' }),
  ],
  customDeduction: [],
  attendanceSummary: null,
  systemNotes: {
    review: [{ dayId: 'd1', date: '2026-10-16', branchId: 'b1', flags: ['DEVICE_CONFLICT'], blocking: true }],
    // บันทึกไว้ตอนบันทึกใบ — หน้ารายละเอียดใช้เวลาปิดงวดสด (`payrollGate`) แทน
    warnings: [{ code: 'NOT_YET_CLOSABLE', closableAt: CLOSABLE_AT }],
  },
};

const LINE_WICHAI = {
  id: 'l2',
  userId: 'u2',
  employeeName: 'วิชัย ทองดี',
  employeeTaxId: null,
  baseSalary: '16500',
  ssoEmployee: '825',
  whtAmount: '0',
  netPaid: '15975',
  customIncome: [income({ id: 'i5', accountCode: 'S52-1202', name: 'OT ที่กรอกเอง', amount: '300' })],
  customDeduction: [],
  attendanceSummary: null,
  systemNotes: { review: [], warnings: [{ code: 'NOT_MONTHLY_OR_NO_BASE', otHours: '3.0' }] },
};

type Gate = { closableAt: string | null; deviceConflicts: Array<Record<string, string>> } | null;

function payrollDoc(status: string, payrollGate: Gate = { closableAt: null, deviceConflicts: [] }) {
  return {
    id: 'pr-1',
    number: 'PR-20261031-0001',
    documentType: 'PAYROLL',
    status,
    documentDate: '2026-10-31',
    vendorName: null,
    vendorTaxId: null,
    description: null,
    subtotal: '32209.38',
    vatAmount: '0',
    withholdingTax: '0',
    totalAmount: '32209.38',
    netPayment: '32209.38',
    branch: { id: 'b1', name: 'สาขาลพบุรี' },
    createdBy: { id: 'maker-1', name: 'ผู้ทำเงินเดือน' },
    expenseDetail: null,
    payroll: { payrollPeriod: '2026-10', entityScope: 'SHOP', lines: [LINE_SOMSRI, LINE_WICHAI] },
    payrollGate,
  };
}

let currentDoc: ReturnType<typeof payrollDoc>;
let queryClient: QueryClient;

function mount(doc: ReturnType<typeof payrollDoc>) {
  currentDoc = doc;
  apiGet.mockImplementation((path: string) =>
    Promise.resolve({ data: path === '/expense-documents/pr-1' ? currentDoc : [] }),
  );
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/expenses/pr-1']}>
        <Routes>
          <Route path="/expenses/:id" element={<ExpenseDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const docFetches = () => apiGet.mock.calls.filter(([p]) => p === '/expense-documents/pr-1').length;
const conflict = (data: Record<string, unknown>) => ({ response: { status: 409, data } });

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  Object.values(toast).forEach((f) => f.mockReset());
  flags.approvalEnabled = true;
});

describe('payroll lines table', () => {
  it('shows base, OT/holiday, other income, SSO and net per line from the stored amounts, with totals', async () => {
    mount(payrollDoc('POSTED', null));
    const row = await screen.findByRole('row', { name: /สมศรี มีสุข/ });
    for (const header of ['พนักงาน', 'ฐาน', 'OT / วันหยุด', 'รายได้อื่น', 'SSO', 'สุทธิ']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    for (const value of ['15,000.00', '1,484.38', '500.00', '750.00', '16,234.38']) {
      expect(within(row).getByText(value)).toBeInTheDocument();
    }
    const wichai = screen.getByRole('row', { name: /วิชัย ทองดี/ });
    for (const value of ['16,500.00', '0.00', '300.00', '825.00', '15,975.00']) {
      expect(within(wichai).getByText(value)).toBeInTheDocument();
    }
    const total = screen.getByRole('row', { name: /รวม/ });
    for (const value of ['31,500.00', '1,484.38', '800.00', '1,575.00', '32,209.38']) {
      expect(within(total).getByText(value)).toBeInTheDocument();
    }
  });

  it('shows the review days and warnings stored per line, but not the stored cutoff note', async () => {
    mount(payrollDoc('PENDING_APPROVAL'));
    const panel = await screen.findByRole('complementary', { name: 'ตรวจก่อนอนุมัติ' });
    expect(within(panel).getByText('วันที่ต้องตรวจ (1)')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /เปิดวันนั้นที่ ลงเวลา/ })).toHaveAttribute(
      'href',
      '/attendance?tab=today&date=2026-10-16&branchId=b1',
    );
    expect(within(panel).getByText(/ระบบไม่คิด OT ให้ ลงเวลาเดือนนี้มี OT 3 ชม\./)).toBeInTheDocument();
    expect(within(panel).queryByText(SUBMIT_CUTOFF)).not.toBeInTheDocument();
  });
});

describe('cutoff gate (payrollGate.closableAt in the future)', () => {
  it('DRAFT with approval: info banner and ส่งให้อนุมัติ disabled with ยังไม่ถึงเวลาปิดงวด', async () => {
    mount(payrollDoc('DRAFT', { closableAt: CLOSABLE_AT, deviceConflicts: [] }));
    expect((await screen.findByText(SUBMIT_CUTOFF)).closest('[role="status"]')).not.toBeNull();
    const submit = screen.getByRole('button', { name: /ส่งให้อนุมัติ/ });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-describedby', screen.getByText('ยังไม่ถึงเวลาปิดงวด').id);
  });

  it('PENDING_APPROVAL: the post-cutoff banner and อนุมัติและลงบัญชี disabled', async () => {
    mount(payrollDoc('PENDING_APPROVAL', { closableAt: CLOSABLE_AT, deviceConflicts: [] }));
    expect((await screen.findByText(POST_CUTOFF)).closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /อนุมัติและลงบัญชี/ })).toBeDisabled();
    expect(screen.getByText('ยังไม่ถึงเวลาปิดงวด')).toBeVisible();
  });

  it('APPROVED: บันทึกและลงบัญชี disabled with the reason', async () => {
    mount(payrollDoc('APPROVED', { closableAt: CLOSABLE_AT, deviceConflicts: [] }));
    expect(await screen.findByText(POST_CUTOFF)).toBeVisible();
    expect(screen.getByRole('button', { name: /บันทึกและลงบัญชี/ })).toBeDisabled();
    expect(screen.getByText('ยังไม่ถึงเวลาปิดงวด')).toBeVisible();
  });

  it('DRAFT without approval posts directly, so it shows the post-cutoff copy', async () => {
    flags.approvalEnabled = false;
    mount(payrollDoc('DRAFT', { closableAt: CLOSABLE_AT, deviceConflicts: [] }));
    expect(await screen.findByText(POST_CUTOFF)).toBeVisible();
    expect(screen.getByRole('button', { name: /บันทึกและลงบัญชี/ })).toBeDisabled();
  });

  it('no gate (posted payroll): no banner and no blocked reason', async () => {
    mount(payrollDoc('POSTED', null));
    await screen.findByRole('row', { name: /สมศรี มีสุข/ });
    expect(screen.queryByText(POST_CUTOFF)).not.toBeInTheDocument();
    expect(screen.queryByText('ยังไม่ถึงเวลาปิดงวด')).not.toBeInTheDocument();
  });
});

describe('device-conflict gate', () => {
  const day = { dayId: 'd1', userId: 'u1', employeeName: 'สมศรี มีสุข', date: '2026-10-16' };

  it('PENDING_APPROVAL: destructive alert and อนุมัติและลงบัญชี disabled with ติดธง เครื่องถูกใช้ซ้อน 1 วัน', async () => {
    mount(payrollDoc('PENDING_APPROVAL', { closableAt: null, deviceConflicts: [day] }));
    expect((await screen.findByText(DEVICE_CONFLICT)).closest('[role="alert"]')).not.toBeNull();
    const approve = screen.getByRole('button', { name: /อนุมัติและลงบัญชี/ });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute('aria-describedby', screen.getByText('ติดธง เครื่องถูกใช้ซ้อน 1 วัน').id);
  });

  it('APPROVED: บันทึกและลงบัญชี is blocked by the flag too', async () => {
    mount(payrollDoc('APPROVED', { closableAt: null, deviceConflicts: [day] }));
    expect(await screen.findByText(DEVICE_CONFLICT)).toBeVisible();
    expect(screen.getByRole('button', { name: /บันทึกและลงบัญชี/ })).toBeDisabled();
    expect(screen.getByText('ติดธง เครื่องถูกใช้ซ้อน 1 วัน')).toBeVisible();
  });

  it('DRAFT: submitting is not blocked by the flag (only approve/post are)', async () => {
    mount(payrollDoc('DRAFT', { closableAt: null, deviceConflicts: [day] }));
    expect(await screen.findByText(DEVICE_CONFLICT)).toBeVisible();
    expect(screen.getByRole('button', { name: /ส่งให้อนุมัติ/ })).toBeEnabled();
  });
});

describe('409 from approve / post', () => {
  it('PAYROLL_STALE: alert with the server message, the diff table and แก้ไข — then reloads the document', async () => {
    mount(payrollDoc('PENDING_APPROVAL'));
    apiPost.mockRejectedValue(
      conflict({
        code: 'PAYROLL_STALE',
        message: STALE,
        diffs: [
          {
            userId: 'u2',
            employeeName: 'วิชัย ทองดี',
            label: 'OT วันทำงาน (1.5 เท่า)',
            stored: { amount: '154.69', hours: '1.5' },
            current: { amount: '257.81', hours: '2.5' },
          },
        ],
      }),
    );
    const approve = await screen.findByRole('button', { name: /อนุมัติและลงบัญชี/ });
    const fetchesBefore = docFetches();
    await userEvent.click(approve);
    const alert = (await screen.findByText(STALE)).closest('[role="alert"]') as HTMLElement;
    expect(alert).not.toBeNull();
    const diffRow = within(alert).getByRole('row', { name: /วิชัย ทองดี/ });
    expect(within(diffRow).getByText('OT วันทำงาน (1.5 เท่า)')).toBeInTheDocument();
    expect(within(diffRow).getByText('1.5 ชม. · 154.69')).toBeInTheDocument();
    expect(within(diffRow).getByText('2.5 ชม. · 257.81')).toBeInTheDocument();
    expect(within(alert).getByRole('link', { name: 'แก้ไข' })).toHaveAttribute('href', '/expenses/new?edit=pr-1');
    expect(toast.error).not.toHaveBeenCalled();
    // ด่านอาจเปลี่ยนไปแล้ว (เช่น ติดธงเพิ่ม) — โหลดใบใหม่ให้แบนเนอร์ตรงกับ server · แจ้งเตือนยังอยู่
    await waitFor(() => expect(docFetches()).toBeGreaterThan(fetchesBefore));
    expect(screen.getByText(STALE)).toBeVisible();
  });

  it('the stale alert goes away once the document changes status (sent back to draft elsewhere)', async () => {
    mount(payrollDoc('PENDING_APPROVAL'));
    apiPost.mockRejectedValue(conflict({ code: 'PAYROLL_STALE', message: STALE, diffs: [] }));
    const approve = await screen.findByRole('button', { name: /อนุมัติและลงบัญชี/ });
    // ผู้ทำเงินเดือนกด แก้ไข + บันทึกไปแล้ว — ใบที่โหลดใหม่หลัง 409 เป็นร่าง
    currentDoc = payrollDoc('DRAFT');
    await userEvent.click(approve);
    await screen.findByRole('button', { name: /ส่งให้อนุมัติ/ });
    expect(screen.queryByText(STALE)).not.toBeInTheDocument();
  });

  it('another payroll 409 shows the server message as is', async () => {
    mount(payrollDoc('PENDING_APPROVAL'));
    const message = 'OT ของ สมศรี มีสุข เดือนนี้อยู่ในใบ PR-20261030-0002 แล้ว — เอาออกจากใบใดใบหนึ่งก่อน';
    apiPost.mockRejectedValue(conflict({ code: 'PAYROLL_OTHER_DOC', documentNumber: 'PR-20261030-0002', message }));
    await userEvent.click(await screen.findByRole('button', { name: /อนุมัติและลงบัญชี/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
  });

  it('a successful approve refreshes the detail, the list and the edit form caches', async () => {
    mount(payrollDoc('PENDING_APPROVAL'));
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    apiPost.mockResolvedValue({ data: {} });
    await userEvent.click(await screen.findByRole('button', { name: /อนุมัติและลงบัญชี/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const keys = spy.mock.calls.map(([f]) => JSON.stringify((f as { queryKey: unknown[] }).queryKey));
    expect(keys).toEqual(
      expect.arrayContaining([
        JSON.stringify(['expense-document', 'pr-1']),
        JSON.stringify(['expenses']),
        JSON.stringify(['expense-doc-edit', 'pr-1']),
      ]),
    );
  });
});

describe('payroll actions', () => {
  it.each(['DRAFT', 'PENDING_APPROVAL', 'APPROVED'])('%s: แก้ไข opens the payroll edit form', async (status) => {
    mount(payrollDoc(status));
    expect(await screen.findByRole('link', { name: 'แก้ไข' })).toHaveAttribute('href', '/expenses/new?edit=pr-1');
  });

  it('POSTED: no แก้ไข, and the slip link with its count and the paper-only note', async () => {
    mount(payrollDoc('POSTED', null));
    const slip = await screen.findByRole('link', { name: /พิมพ์สลิปเงินเดือน \(2 ใบ\)/ });
    expect(slip).toHaveAttribute('href', '/expenses/pr-1/voucher');
    expect(screen.getByText('สลิปพิมพ์กระดาษเท่านั้น — ไม่มีส่งทาง LINE หรืออีเมล')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'แก้ไข' })).not.toBeInTheDocument();
  });

  it('before posting the slip button is disabled with ลงบัญชีก่อนจึงพิมพ์สลิปได้', async () => {
    mount(payrollDoc('DRAFT'));
    const slip = await screen.findByRole('button', { name: /พิมพ์สลิปเงินเดือน \(2 ใบ\)/ });
    expect(slip).toBeDisabled();
    expect(slip).toHaveAttribute('aria-describedby', screen.getByText('ลงบัญชีก่อนจึงพิมพ์สลิปได้').id);
    expect(screen.queryByRole('link', { name: /พิมพ์สลิปเงินเดือน/ })).not.toBeInTheDocument();
  });

  it('VOIDED: no slip button and no แก้ไข', async () => {
    mount(payrollDoc('VOIDED', null));
    await screen.findByRole('row', { name: /สมศรี มีสุข/ });
    expect(screen.queryByRole('button', { name: /พิมพ์สลิปเงินเดือน/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /พิมพ์สลิปเงินเดือน/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'แก้ไข' })).not.toBeInTheDocument();
  });
});
