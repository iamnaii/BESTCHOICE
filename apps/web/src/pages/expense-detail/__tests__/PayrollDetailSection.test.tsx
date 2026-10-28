import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const OWNER = { id: 'owner-1', name: 'เจ้าของ', role: 'OWNER', branchId: 'b1', canReverseOverride: null };
const auth = vi.hoisted(() => ({ user: null as Record<string, unknown> | null }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));
const perms = vi.hoisted(() => ({ allowed: true }));
vi.mock('@/hooks/useAccountingPermissions', () => ({ useAccountingPermissions: () => ({ can: () => perms.allowed }) }));
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
/** R20 FX2 — `updatedAt` ของใบที่หน้าวาด · ส่งกลับตอนอนุมัติ/ลงบัญชี */
const RENDERED_AT = '2026-11-02T03:15:20.123Z';
const DOCUMENT_CHANGED = 'ใบนี้ถูกแก้ไขหลังจากที่คุณเปิดดู — โหลดหน้านี้ใหม่ ตรวจยอดอีกครั้ง แล้วกด อนุมัติและลงบัญชี';

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
    // เก็บไว้ตอนบันทึก — หน้ารายละเอียดเทียบธง DEVICE_CONFLICT กับ `payrollGate` สด (ล้างธงแล้ว = ไม่แสดง)
    review: [
      { dayId: 'd1', date: '2026-10-16', branchId: 'b1', flags: ['DEVICE_CONFLICT'], blocking: true },
      { dayId: 'd3', date: '2026-10-20', branchId: 'b1', flags: ['DEVICE_CONFLICT', 'NO_PHOTO'], blocking: true },
    ],
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
    updatedAt: RENDERED_AT,
  };
}

let currentDoc: ReturnType<typeof payrollDoc>;
let queryClient: QueryClient;

function mount(doc: ReturnType<typeof payrollDoc>) {
  currentDoc = doc;
  apiGet.mockImplementation((path: string) =>
    Promise.resolve({ data: path === '/expense-documents/pr-1' ? currentDoc : [] }),
  );
  // ค่าเริ่มต้นเดียวกับแอป (main.tsx) — ไม่โหลดใหม่ตอนกลับมาที่หน้าต่าง · ข้อมูลสด 3 นาที
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 3 * 60 * 1000 },
      mutations: { retry: false },
    },
  });
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
  auth.user = OWNER;
  perms.allowed = true;
});
afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const day = { dayId: 'd1', userId: 'u1', employeeName: 'สมศรี มีสุข', date: '2026-10-16', branchId: 'b1' };
const approveButton = () => screen.getByRole('button', { name: /อนุมัติและลงบัญชี/ });
const refocusWindow = () =>
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
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
      '/attendance?tab=today&date=2026-10-20&branchId=b1',
    );
    expect(within(panel).getByText(/ระบบไม่คิด OT ให้ ลงเวลาเดือนนี้มี OT 3 ชม\./)).toBeInTheDocument();
    expect(within(panel).queryByText(SUBMIT_CUTOFF)).not.toBeInTheDocument();
  });

  it('notes under the table that net is after tax and other deductions', async () => {
    mount(payrollDoc('POSTED', null));
    expect(await screen.findByText('สุทธิ = หลังหักภาษีและรายการหักอื่น')).toBeVisible();
  });

  // R15.1 — ธงเครื่องถูกใช้ซ้อนที่เก็บไว้ตอนบันทึกอาจถูกเจ้าของล้างไปแล้ว — เชื่อ `payrollGate` สด
  it('keeps only the stored DEVICE_CONFLICT chips the live gate still has, and drops days left with no flag', async () => {
    mount(payrollDoc('PENDING_APPROVAL', { closableAt: null, deviceConflicts: [] }));
    const panel = await screen.findByRole('complementary', { name: 'ตรวจก่อนอนุมัติ' });
    expect(within(panel).getByText('วันที่ต้องตรวจ (1)')).toBeInTheDocument();
    expect(panel.querySelector('[data-flag="DEVICE_CONFLICT"]')).toBeNull();
    expect(panel.querySelector('[data-flag="NO_PHOTO"]')).not.toBeNull();
  });

  it('a day still flagged in the live gate keeps its chip', async () => {
    mount(payrollDoc('PENDING_APPROVAL', { closableAt: null, deviceConflicts: [day] }));
    const panel = await screen.findByRole('complementary', { name: 'ตรวจก่อนอนุมัติ' });
    expect(within(panel).getByText('วันที่ต้องตรวจ (2)')).toBeInTheDocument();
    expect(panel.querySelectorAll('[data-flag="DEVICE_CONFLICT"]')).toHaveLength(1);
  });

  it('without a gate (posted) the stored review days stay as saved', async () => {
    mount(payrollDoc('POSTED', null));
    const panel = await screen.findByRole('complementary', { name: 'ตรวจก่อนอนุมัติ' });
    expect(panel.querySelectorAll('[data-flag="DEVICE_CONFLICT"]')).toHaveLength(2);
  });
});

// D4 ส่วนที่ 2 (P2-R19.4) — ค่าคอมมีคอลัมน์ของตัวเอง (ไม่ปนรายได้อื่น) · ยอดที่ยกไปงวดหน้าจากคำเตือน CLAWBACK_CARRIED ของบรรทัด
describe('payroll lines table — commission column', () => {
  const LINE_COMMISSION = {
    ...LINE_WICHAI,
    id: 'l3',
    userId: 'u3',
    employeeName: 'ปรีชา ศรีสุข',
    netPaid: '14250',
    customIncome: [
      income({ id: 'i6', accountCode: 'S51-1101', name: 'ค่าคอมมิชชัน (2 รายการ)', amount: '1000.00', source: 'COMMISSION' }),
      income({ id: 'i7', accountCode: 'S52-1204', name: 'เบี้ยขยัน', amount: '250' }),
    ],
    customDeduction: [
      { id: 'd1', accountCode: 'S51-1101', name: 'หักคืนค่าคอม (2 รายการ)', amount: '1000.00', source: 'COMMISSION_CLAWBACK' },
    ],
    systemNotes: { review: [], warnings: [{ code: 'CLAWBACK_CARRIED', deducted: '1000.00', carried: '400.00' }] },
  };
  const withCommission = () => {
    const doc = payrollDoc('POSTED', null);
    return { ...doc, payroll: { ...doc.payroll, lines: [LINE_SOMSRI, LINE_COMMISSION] } } as unknown as ReturnType<typeof payrollDoc>;
  };

  it('COMMISSION rows leave รายได้อื่น for their own ค่าคอม column, with a total', async () => {
    mount(withCommission());
    const row = await screen.findByRole('row', { name: /ปรีชา ศรีสุข/ });
    expect(screen.getByRole('columnheader', { name: 'ค่าคอม' })).toBeInTheDocument();
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent);
    // พนักงาน · ฐาน · OT/วันหยุด · ค่าคอม · รายได้อื่น · SSO · สุทธิ
    expect(cells.slice(1)).toEqual(['16,500.00', '0.00', '1,000.00', '250.00', '825.00', '14,250.00']);
    const somsri = within(await screen.findByRole('row', { name: /สมศรี มีสุข/ })).getAllByRole('cell').map((c) => c.textContent);
    expect(somsri.slice(1)).toEqual(['15,000.00', '1,484.38', '0.00', '500.00', '750.00', '16,234.38']);
    const total = within(screen.getByRole('row', { name: /รวม/ })).getAllByRole('cell').map((c) => c.textContent);
    expect(total).toEqual(['31,500.00', '1,484.38', '1,000.00', '750.00', '1,575.00', '30,484.38']);
  });

  it('a line with a commission clawback says หักคืนค่าคอม {x} บาท (stored amount) and ยกไปงวดหน้า {y} บาท under the name', async () => {
    mount(withCommission());
    const row = await screen.findByRole('row', { name: /ปรีชา ศรีสุข/ });
    expect(within(row).getByText(/หักคืนค่าคอม 1,000\.00 บาท/)).toBeInTheDocument();
    expect(within(row).getByText(/ยกไปงวดหน้า 400\.00 บาท/)).toBeInTheDocument();
    expect(within(await screen.findByRole('row', { name: /สมศรี มีสุข/ })).queryByText(/หักคืนค่าคอม/)).not.toBeInTheDocument();
    expect(within(await screen.findByRole('row', { name: /สมศรี มีสุข/ })).queryByText(/ยกไปงวดหน้า/)).not.toBeInTheDocument();
  });

  // P2-R30 — FINANCE_BLOCKED / PAID_OUTSIDE เป็นเรื่องก่อนลงบัญชี (รอฝ่ายบัญชี / ใส่รายการหักเอง) — ใบลงบัญชีแล้วไม่แสดง
  const commissionWarnings = () => {
    const doc = withCommission();
    const lines = doc.payroll.lines.map((l) =>
      l.employeeName === 'ปรีชา ศรีสุข'
        ? {
            ...l,
            systemNotes: {
              review: [],
              warnings: [
                { code: 'CLAWBACK_CARRIED', deducted: '1000.00', carried: '400.00' },
                { code: 'COMMISSION_FINANCE_BLOCKED', count: 1 },
                { code: 'CLAWBACK_PAID_OUTSIDE_PAYROLL', reference: 'CT-20260901-0003' },
                { code: 'COMMISSION_IN_OTHER_DOCUMENT', count: 2, documentId: 'doc-9', documentNumber: 'PR-20261101-0003' },
              ],
            },
          }
        : l,
    );
    return (status: string, gate: Gate) => ({ ...payrollDoc(status, gate), payroll: { ...doc.payroll, lines } }) as unknown as ReturnType<typeof payrollDoc>;
  };
  const FINANCE_BLOCKED = 'ใบฝั่งส่วนกลาง (FINANCE) ยังไม่ดึงค่าคอม — รอฝ่ายบัญชีตอบ';
  const PAID_OUTSIDE = /ค่าคอม CT-20260901-0003 ถูกเรียกคืน แต่จ่ายไปนอกใบเงินเดือน/;

  it('POSTED: the panel drops FINANCE_BLOCKED and CLAWBACK_PAID_OUTSIDE_PAYROLL, keeps CLAWBACK_CARRIED and COMMISSION_IN_OTHER_DOCUMENT', async () => {
    mount(commissionWarnings()('POSTED', null));
    const panel = await screen.findByRole('complementary', { name: 'ตรวจก่อนอนุมัติ' });
    expect(within(panel).queryByText(FINANCE_BLOCKED)).not.toBeInTheDocument();
    expect(within(panel).queryByText(PAID_OUTSIDE)).not.toBeInTheDocument();
    expect(within(panel).getByText(/ยกไปงวดหน้า 400\.00 บาท/)).toBeInTheDocument();
    expect(within(panel).getByText('ค่าคอม 2 รายการของ ปรีชา ศรีสุข อยู่ในใบ PR-20261101-0003 แล้ว')).toBeInTheDocument();
  });

  it.each(['DRAFT', 'PENDING_APPROVAL', 'APPROVED'])('%s: the panel still shows all four commission warnings', async (status) => {
    mount(commissionWarnings()(status, { closableAt: null, deviceConflicts: [] }));
    const panel = await screen.findByRole('complementary', { name: 'ตรวจก่อนอนุมัติ' });
    expect(within(panel).getByText(FINANCE_BLOCKED)).toBeInTheDocument();
    expect(within(panel).getByText(PAID_OUTSIDE)).toBeInTheDocument();
    expect(within(panel).getByText(/ยกไปงวดหน้า 400\.00 บาท/)).toBeInTheDocument();
  });

  it('a payroll with no commission keeps the original five columns', async () => {
    mount(payrollDoc('POSTED', null));
    await screen.findByRole('row', { name: /สมศรี มีสุข/ });
    expect(screen.queryByRole('columnheader', { name: 'ค่าคอม' })).not.toBeInTheDocument();
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
  it('PENDING_APPROVAL: destructive banner and อนุมัติและลงบัญชี disabled with ติดธง เครื่องถูกใช้ซ้อน 1 วัน', async () => {
    mount(payrollDoc('PENDING_APPROVAL', { closableAt: null, deviceConflicts: [day] }));
    // แบนเนอร์คงที่ตอนเปิดหน้า = status · role=alert เฉพาะผลจากการกดปุ่ม (409 ยอดเปลี่ยน)
    expect((await screen.findByText(DEVICE_CONFLICT)).closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

  // R15.2 — กระดาน 6A "เปิดวันนั้นที่ ลงเวลา" ต่อวัน (สาขาของวันนั้น · สิทธิ์เดียวกับแผงตรวจ)
  it('lists each flagged day with a link to that day and its branch on ลงเวลา (OWNER)', async () => {
    mount(payrollDoc('PENDING_APPROVAL', { closableAt: null, deviceConflicts: [{ ...day, branchId: 'b2' }] }));
    const banner = (await screen.findByText(DEVICE_CONFLICT)).closest('[role="status"]') as HTMLElement;
    expect(within(banner).getByRole('link', { name: /เปิดวันนั้นที่ ลงเวลา/ })).toHaveAttribute(
      'href',
      '/attendance?tab=today&date=2026-10-16&branchId=b2',
    );
  });

  it('a BRANCH_MANAGER of another branch gets the text instead of the link', async () => {
    auth.user = { ...OWNER, id: 'bm-1', role: 'BRANCH_MANAGER', branchId: 'b1' };
    mount(payrollDoc('PENDING_APPROVAL', { closableAt: null, deviceConflicts: [{ ...day, branchId: 'b2' }] }));
    const banner = (await screen.findByText(DEVICE_CONFLICT)).closest('[role="status"]') as HTMLElement;
    expect(within(banner).queryByRole('link')).not.toBeInTheDocument();
    expect(within(banner).getByText('ให้เจ้าของหรือผู้จัดการสาขาตรวจที่เมนู ลงเวลา')).toBeInTheDocument();
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
    expect(within(alert).getByText('กด แก้ไข แล้วใบกลับเป็นร่างเอง — ไม่ต้องรอผู้อนุมัติกดส่งกลับ')).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    // ด่านอาจเปลี่ยนไปแล้ว (เช่น ติดธงเพิ่ม) — โหลดใบใหม่ให้แบนเนอร์ตรงกับ server · แจ้งเตือนยังอยู่
    await waitFor(() => expect(docFetches()).toBeGreaterThan(fetchesBefore));
    expect(screen.getByText(STALE)).toBeVisible();

    await userEvent.click(within(alert).getByRole('button', { name: 'ปิด' }));
    expect(screen.queryByText(STALE)).not.toBeInTheDocument();
    // ปุ่มปิดหายไปพร้อมแจ้งเตือน — โฟกัสไปที่หัวตารางบรรทัด ไม่หลุดไปที่ body
    expect(screen.getByRole('heading', { name: 'รายการเงินเดือน (2 คน)' })).toHaveFocus();
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

  it('R20 FX2: approve sends the version the page rendered (expectedUpdatedAt = doc.updatedAt)', async () => {
    mount(payrollDoc('PENDING_APPROVAL'));
    apiPost.mockResolvedValue({ data: {} });
    await userEvent.click(await screen.findByRole('button', { name: /อนุมัติและลงบัญชี/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/expense-documents/pr-1/approve', { expectedUpdatedAt: RENDERED_AT }));
  });

  it('R20 FX2: บันทึกและลงบัญชี on an APPROVED payroll sends the version the page rendered', async () => {
    mount(payrollDoc('APPROVED'));
    apiPost.mockResolvedValue({ data: {} });
    await userEvent.click(await screen.findByRole('button', { name: /บันทึกและลงบัญชี/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/expense-documents/pr-1/post', { expectedUpdatedAt: RENDERED_AT }));
  });

  it('R21: a non-payroll document keeps today\'s body — approve and post send {} (no version token)', async () => {
    const expense = { ...payrollDoc('PENDING_APPROVAL'), documentType: 'EXPENSE', payroll: undefined, payrollGate: undefined };
    mount(expense as unknown as ReturnType<typeof payrollDoc>);
    apiPost.mockResolvedValue({ data: {} });
    await userEvent.click(await screen.findByRole('button', { name: /อนุมัติและลงบัญชี/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/expense-documents/pr-1/approve', {}));

    currentDoc = { ...expense, status: 'APPROVED' } as unknown as ReturnType<typeof payrollDoc>;
    await queryClient.invalidateQueries({ queryKey: ['expense-document', 'pr-1'] });
    await userEvent.click(await screen.findByRole('button', { name: /บันทึกและลงบัญชี/ }));
    await waitFor(() => expect(apiPost).toHaveBeenLastCalledWith('/expense-documents/pr-1/post', {}));
  });

  it('R20 FX2: 409 DOCUMENT_CHANGED shows the server message and reloads the document; the next approve sends the reloaded version', async () => {
    mount(payrollDoc('PENDING_APPROVAL'));
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    apiPost.mockRejectedValueOnce(conflict({ code: 'DOCUMENT_CHANGED', message: DOCUMENT_CHANGED }));
    const approve = await screen.findByRole('button', { name: /อนุมัติและลงบัญชี/ });
    const fetchesBefore = docFetches();
    // ผู้ทำเงินเดือนแก้แล้วส่งใหม่ระหว่างที่หน้านี้เปิดค้าง — ใบที่โหลดใหม่เป็นฉบับใหม่
    const reloadedAt = '2026-11-02T03:16:01.456Z';
    currentDoc = { ...payrollDoc('PENDING_APPROVAL'), updatedAt: reloadedAt, totalAmount: '34209.38' };
    await userEvent.click(approve);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(DOCUMENT_CHANGED));
    await waitFor(() => expect(docFetches()).toBeGreaterThan(fetchesBefore));
    const keys = spy.mock.calls.map(([f]) => JSON.stringify((f as { queryKey: unknown[] }).queryKey));
    expect(keys).toEqual(expect.arrayContaining([JSON.stringify(['expense-document', 'pr-1']), JSON.stringify(['expenses'])]));
    expect(toast.success).not.toHaveBeenCalled();

    apiPost.mockResolvedValueOnce({ data: {} });
    await userEvent.click(await screen.findByRole('button', { name: /อนุมัติและลงบัญชี/ }));
    await waitFor(() => expect(apiPost).toHaveBeenLastCalledWith('/expense-documents/pr-1/approve', { expectedUpdatedAt: reloadedAt }));
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
        JSON.stringify(['expense-doc-voucher', 'pr-1']),
      ]),
    );
  });
});

describe('payroll actions', () => {
  it.each(['DRAFT', 'PENDING_APPROVAL', 'APPROVED'])('%s: แก้ไข opens the payroll edit form', async (status) => {
    mount(payrollDoc(status));
    expect(await screen.findByRole('link', { name: 'แก้ไข' })).toHaveAttribute('href', '/expenses/new?edit=pr-1');
  });

  it('DRAFT: แก้ไข says the save recomputes (board 2), other statuses do not', async () => {
    mount(payrollDoc('DRAFT'));
    const edit = await screen.findByRole('link', { name: 'แก้ไข' });
    expect(edit).toHaveAttribute('aria-describedby', screen.getByText('บันทึกใหม่ ระบบคิดยอดให้').id);
  });

  it('PENDING_APPROVAL: no recompute caption on แก้ไข', async () => {
    mount(payrollDoc('PENDING_APPROVAL'));
    await screen.findByRole('link', { name: 'แก้ไข' });
    expect(screen.queryByText('บันทึกใหม่ ระบบคิดยอดให้')).not.toBeInTheDocument();
  });

  it('POSTED: attendance of the people on it is locked, and reversing unlocks it (viewer can reverse)', async () => {
    mount(payrollDoc('POSTED', null));
    expect(
      await screen.findByText('ลงเวลา ต.ค. 2569 ของ 2 คนในใบนี้ แก้ไม่ได้แล้ว — ปรับยอดให้ใส่ในงวดถัดไป'),
    ).toBeVisible();
    expect(screen.getByText('กลับรายการใบนี้ → ลงเวลาเดือนนี้แก้ได้อีก')).toBeVisible();
    expect(screen.getByRole('button', { name: /กลับรายการ/ })).toBeInTheDocument();
  });

  it('POSTED without the cancel permission: the lock note but no reverse line', async () => {
    perms.allowed = false;
    mount(payrollDoc('POSTED', null));
    expect(await screen.findByText(/ลงเวลา ต.ค. 2569 ของ 2 คนในใบนี้ แก้ไม่ได้แล้ว/)).toBeVisible();
    expect(screen.queryByText('กลับรายการใบนี้ → ลงเวลาเดือนนี้แก้ได้อีก')).not.toBeInTheDocument();
  });

  it('DRAFT: no attendance-lock note', async () => {
    mount(payrollDoc('DRAFT'));
    await screen.findByRole('link', { name: 'แก้ไข' });
    expect(screen.queryByText(/แก้ไม่ได้แล้ว/)).not.toBeInTheDocument();
  });

  // R15.6 — กระดาน 2: ไฟล์โอนธนาคารเฉพาะใบที่ลงบัญชีแล้ว
  // R16.4 — ทางที่ข้อความชี้ต้องมีจริงสำหรับ role นั้น: แท็บ HR / เงินเดือน อยู่ในหน้าผู้ใช้ (/users/:id — เจ้าของเท่านั้น)
  describe('skipped-lines toast after the CSV download', () => {
    beforeEach(() => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });
    const csvResponse = { data: new Blob(['x']), headers: { 'x-skipped-lines': '1' } };

    it('OWNER is pointed at the HR tab of the user record', async () => {
      mount(payrollDoc('POSTED', null));
      apiGet.mockImplementation((path: string) =>
        Promise.resolve(path.endsWith('/bank-transfer.csv') ? csvResponse : { data: path === '/expense-documents/pr-1' ? currentDoc : [] }),
      );
      await userEvent.click(await screen.findByRole('button', { name: 'ไฟล์โอนธนาคาร (CSV)' }));
      await waitFor(() =>
        expect(toast.warning).toHaveBeenCalledWith(
          'ข้าม 1 คนที่ไม่มีเลขบัญชีธนาคารในทะเบียนพนักงาน — เพิ่มได้ที่ ตั้งค่าระบบ › ผู้ใช้ & สิทธิ์ › ผู้ใช้ / พนักงาน › แท็บ HR / เงินเดือน',
        ),
      );
    });

    it('ACCOUNTANT cannot open the user record, so it asks the owner', async () => {
      auth.user = { ...OWNER, id: 'acc-1', role: 'ACCOUNTANT' };
      mount(payrollDoc('POSTED', null));
      apiGet.mockImplementation((path: string) =>
        Promise.resolve(path.endsWith('/bank-transfer.csv') ? csvResponse : { data: path === '/expense-documents/pr-1' ? currentDoc : [] }),
      );
      await userEvent.click(await screen.findByRole('button', { name: 'ไฟล์โอนธนาคาร (CSV)' }));
      await waitFor(() =>
        expect(toast.warning).toHaveBeenCalledWith(
          'ข้าม 1 คนที่ไม่มีเลขบัญชีธนาคารในทะเบียนพนักงาน — ให้เจ้าของเพิ่มเลขบัญชีที่ ตั้งค่าระบบ › ผู้ใช้ & สิทธิ์ › ผู้ใช้ / พนักงาน',
        ),
      );
    });
  });

  it('the bank-transfer CSV is available only once posted', async () => {
    mount(payrollDoc('POSTED', null));
    const csv = await screen.findByRole('button', { name: 'ไฟล์โอนธนาคาร (CSV)' });
    expect(csv).toBeEnabled();
    expect(screen.queryByText('ลงบัญชีก่อนจึงดาวน์โหลดไฟล์โอนได้')).not.toBeInTheDocument();
  });

  it.each(['DRAFT', 'PENDING_APPROVAL', 'APPROVED'])('%s: the CSV button is disabled with ลงบัญชีก่อนจึงดาวน์โหลดไฟล์โอนได้', async (status) => {
    mount(payrollDoc(status));
    const csv = await screen.findByRole('button', { name: 'ไฟล์โอนธนาคาร (CSV)' });
    expect(csv).toBeDisabled();
    expect(csv).toHaveAttribute('aria-describedby', screen.getByText('ลงบัญชีก่อนจึงดาวน์โหลดไฟล์โอนได้').id);
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

  it('VOIDED: no slip button, no CSV and no แก้ไข', async () => {
    mount(payrollDoc('VOIDED', null));
    await screen.findByRole('row', { name: /สมศรี มีสุข/ });
    expect(screen.queryByRole('button', { name: 'ไฟล์โอนธนาคาร (CSV)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /พิมพ์สลิปเงินเดือน/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /พิมพ์สลิปเงินเดือน/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'แก้ไข' })).not.toBeInTheDocument();
  });
});

// I1 — ปุ่มที่ถูกปิดต้องเปิดเองเมื่อด่านหมด: server เป็นผู้ตัดสินเสมอ (ไม่ใช้นาฬิกาเครื่องเปิดปุ่มเอง) —
// หน้าโหลดใบใหม่เมื่อถึงเวลาปิดงวด และเมื่อกลับมาที่หน้าต่างนี้ระหว่างที่ด่านยังปิดปุ่มอยู่ (กระดาน 6A: ล้างธงในอีกแท็บ)
describe('gate refresh while the page stays open', () => {
  it('coming back to the window while blocked re-reads the document; a cleared gate re-enables approve', async () => {
    mount(payrollDoc('PENDING_APPROVAL', { closableAt: null, deviceConflicts: [day] }));
    await screen.findByText(DEVICE_CONFLICT);
    expect(approveButton()).toBeDisabled();
    currentDoc = payrollDoc('PENDING_APPROVAL', { closableAt: null, deviceConflicts: [] });
    const before = docFetches();
    refocusWindow();
    await waitFor(() => expect(docFetches()).toBeGreaterThan(before));
    await waitFor(() => expect(approveButton()).toBeEnabled());
    expect(screen.queryByText(DEVICE_CONFLICT)).not.toBeInTheDocument();
  });

  it('coming back to the window when nothing is blocked does not re-read', async () => {
    mount(payrollDoc('PENDING_APPROVAL'));
    await screen.findByRole('row', { name: /สมศรี มีสุข/ });
    const before = docFetches();
    refocusWindow();
    await new Promise((r) => setTimeout(r, 50));
    expect(docFetches()).toBe(before);
  });

  it('re-reads the document when the cutoff instant passes, which re-enables the buttons', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-11-01T10:59:00.000Z'));
    mount(payrollDoc('PENDING_APPROVAL', { closableAt: CLOSABLE_AT, deviceConflicts: [] }));
    await screen.findByText(POST_CUTOFF);
    expect(approveButton()).toBeDisabled();
    currentDoc = payrollDoc('PENDING_APPROVAL', { closableAt: null, deviceConflicts: [] });
    const before = docFetches();
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(docFetches()).toBe(before);
    await act(async () => {
      vi.advanceTimersByTime(32_000);
    });
    await waitFor(() => expect(docFetches()).toBeGreaterThan(before));
    await waitFor(() => expect(approveButton()).toBeEnabled());
    expect(screen.queryByText(POST_CUTOFF)).not.toBeInTheDocument();
  });

  it('a cutoff further away than one timer can wait still fires on time (no early cutoff refresh)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // 40 วันก่อนเวลาปิดงวด — setTimeout รอได้ไม่เกิน ~24.8 วัน (เกินแล้วยิงทันที)
    vi.setSystemTime(new Date(Date.parse(CLOSABLE_AT) - 40 * 24 * 3600 * 1000));
    mount(payrollDoc('PENDING_APPROVAL', { closableAt: CLOSABLE_AT, deviceConflicts: [] }));
    await screen.findByText(POST_CUTOFF);
    // ตัวตั้งเวลาปิดงวดสั่ง invalidate · การถามทุก 60 วินาที (R16) เป็น refetch ของ query เอง — แยกกันด้วย spy นี้
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const cutoffRefreshes = () =>
      spy.mock.calls.filter(([f]) => JSON.stringify((f as { queryKey: unknown[] }).queryKey) === JSON.stringify(['expense-document', 'pr-1'])).length;
    await act(async () => {
      vi.advanceTimersByTime(30 * 24 * 3600 * 1000);
    });
    expect(cutoffRefreshes()).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(10 * 24 * 3600 * 1000 + 2_000);
    });
    expect(cutoffRefreshes()).toBe(1);
  });
});

// R16 — นาฬิกาเครื่องเร็วกว่า server / ล้างธงจากอีกหน้าต่างหรืออีกเครื่อง (ไม่มี visibilitychange):
// ระหว่างที่ด่านปิดปุ่มอยู่ หน้าถาม server ทุก 60 วินาที และหยุดเมื่อไม่มีอะไรปิดปุ่มแล้ว
describe('gate polling while blocked', () => {
  const advance = (ms: number) =>
    act(async () => {
      vi.advanceTimersByTime(ms);
    });

  it('a client clock ahead of the server: the cutoff refetch still says not yet, and polling recovers within 60 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(Date.parse(CLOSABLE_AT) + 5_000));
    mount(payrollDoc('PENDING_APPROVAL', { closableAt: CLOSABLE_AT, deviceConflicts: [] }));
    await screen.findByText(POST_CUTOFF);
    // นาฬิกาเครื่องเลยเวลาแล้ว ⇒ ถามทันที แต่ server ยังตอบเวลาเดิม
    await waitFor(() => expect(docFetches()).toBe(2));
    expect(approveButton()).toBeDisabled();
    currentDoc = payrollDoc('PENDING_APPROVAL', { closableAt: null, deviceConflicts: [] });
    await advance(60_000);
    await waitFor(() => expect(approveButton()).toBeEnabled());
  });

  it('a flag cleared elsewhere shows up within 60 s, then polling stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount(payrollDoc('PENDING_APPROVAL', { closableAt: null, deviceConflicts: [day] }));
    await screen.findByText(DEVICE_CONFLICT);
    currentDoc = payrollDoc('PENDING_APPROVAL', { closableAt: null, deviceConflicts: [] });
    await advance(60_000);
    await waitFor(() => expect(approveButton()).toBeEnabled());
    const settled = docFetches();
    await advance(180_000);
    expect(docFetches()).toBe(settled);
  });

  it.each([
    ['PENDING_APPROVAL', { closableAt: null, deviceConflicts: [] }],
    ['POSTED', null],
    ['VOIDED', null],
  ] as const)('%s with nothing blocking never polls', async (status, gate) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount(payrollDoc(status, gate as Gate));
    await screen.findByRole('row', { name: /สมศรี มีสุข/ });
    const before = docFetches();
    await advance(180_000);
    expect(docFetches()).toBe(before);
  });
});
