import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();
let approvalEnabled = false;
let allowed = true;
vi.mock('@/lib/api', () => ({
  default: { get: (...args: unknown[]) => apiGet(...args), post: (...args: unknown[]) => apiPost(...args) },
  getErrorMessage: () => 'โหลดไม่สำเร็จ',
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/useAccountingPermissions', () => ({ useAccountingPermissions: () => ({ can: () => allowed }) }));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({
  paginationSize: 20, templatesEnabled: false, approvalEnabled,
  approvalThreshold: 1000, approvalRequiredDocTypes: [], reverseReasons: [], reverseReasonRequired: false,
}) }));
vi.mock('@/hooks/useCoa', () => ({ useCoaGroups: () => ({ data: { groups: [] } }) }));
vi.mock('@/components/accounting/ReopenedPeriodBanner', () => ({ ReopenedPeriodBanner: () => null }));
vi.mock('@/components/expense-form-v4/ExpenseFormV4', () => ({ ExpenseFormV4: () => <div role="dialog" aria-label="สร้างรายจ่ายใหม่" /> }));
import ExpensesPage from './ExpensesPage';

let queryClient: QueryClient;
function LocationProbe() { const l = useLocation(); return <output data-testid="location">{l.pathname + l.search}</output>; }
function mount(status = 'DRAFT', documentType = 'EXPENSE') {
  const row = { id: 'expense-1', number: 'EX-001', status, documentType, vendorName: 'ผู้ขายตัวอย่าง',
    branchId: 'branch-1', branch: { id: 'branch-1', name: 'สาขาตัวอย่าง' },
    documentDate: '2026-10-19', createdAt: '2026-10-19', totalAmount: '1000', netPayment: '1000', expenseDetail: { lines: [] },
  };
  apiGet.mockImplementation((path: string) => Promise.resolve({ data:
    path.startsWith('/expense-documents?') ? { data: [row], total: 1 }
    : path.includes('/summary') ? { totalCount: 1, byStatus: {}, accrualUnpaidCount: 0, accrualUnpaidTotal: '0' } : [],
  }));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={['/expenses']}><ExpensesPage /><LocationProbe /></MemoryRouter>
  </QueryClientProvider>);
}
const trigger = () => screen.getByRole('button', { name: 'เมนู EX-001' });
beforeEach(() => {
  apiGet.mockReset(); apiPost.mockReset(); approvalEnabled = false; allowed = true;
  Object.values(toast).forEach((f) => f.mockReset());
});

describe('expense row menu', () => {
  it('opens outside the table and supports keyboard dismissal', async () => {
    const user = userEvent.setup(); mount();
    (await screen.findByRole('button', { name: 'เมนู EX-001' })).focus();
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    expect(menu.closest('td')).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger()).toHaveFocus());
  });
  it('explains unsupported editing instead of opening a create form', async () => {
    mount(); await userEvent.click(await screen.findByRole('button', { name: 'เมนู EX-001' }));
    expect(await screen.findByRole('menuitem', { name: 'แก้ไข' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('ยังไม่รองรับการแก้ไขเอกสารประเภทนี้')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });
  it('keeps payroll editing on the existing edit route', async () => {
    mount('DRAFT', 'PAYROLL'); await userEvent.click(await screen.findByRole('button', { name: 'เมนู EX-001' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'แก้ไข' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses/new?edit=expense-1');
  });
  // Payroll D4 คำตัดสิน 6 — ส่งกลับเป็นร่าง = กด "แก้ไข" ใบที่รออนุมัติ/อนุมัติแล้ว (server ตั้งกลับเป็นร่างตอนบันทึก)
  it.each(['PENDING_APPROVAL', 'APPROVED'])('offers แก้ไข on a %s payroll and opens the edit route', async (status) => {
    mount(status, 'PAYROLL'); await userEvent.click(await screen.findByRole('button', { name: 'เมนู EX-001' }));
    const edit = await screen.findByRole('menuitem', { name: 'แก้ไข' });
    expect(edit).not.toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(edit);
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses/new?edit=expense-1');
  });
  it('offers no edit on a PENDING_APPROVAL document that is not payroll', async () => {
    mount('PENDING_APPROVAL'); await userEvent.click(await screen.findByRole('button', { name: 'เมนู EX-001' }));
    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: 'แก้ไข' })).not.toBeInTheDocument();
  });
  it.each(['โพสต์', 'ยกเลิก'])('opens %s confirmation and restores row focus after Escape without a write', async (name) => {
    const user = userEvent.setup(); mount();
    await user.click(await screen.findByRole('button', { name: 'เมนู EX-001' }));
    await user.click(await screen.findByRole('menuitem', { name }));
    expect(await screen.findByRole('dialog')).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger()).toHaveFocus());
    expect(apiPost).not.toHaveBeenCalled();
  });
  it('retains approval gating instead of offering direct posting', async () => {
    approvalEnabled = true; mount();
    await userEvent.click(await screen.findByRole('button', { name: 'เมนู EX-001' }));
    expect(await screen.findByRole('menuitem', { name: 'ส่งขออนุมัติ' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'โพสต์' })).not.toBeInTheDocument();
  });
  it('keeps permission-restricted posting and cancellation hidden', async () => {
    allowed = false; mount('APPROVED');
    await userEvent.click(await screen.findByRole('button', { name: 'เมนู EX-001' }));
    expect(screen.queryByRole('menuitem', { name: 'โพสต์' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'ยกเลิก' })).not.toBeInTheDocument();
  });
  it('has no action menu for voided records', async () => {
    mount('VOIDED'); await screen.findByText('EX-001');
    expect(screen.queryByRole('button', { name: 'เมนู EX-001' })).not.toBeInTheDocument();
  });
});

// Payroll D4 ส่วนที่ 1 (Task 8) — อนุมัติ/ลงบัญชีใบเงินเดือนต้องผ่านด่าน (เวลาปิดงวด · วันติดธง · ยอดเปลี่ยน) ที่หน้ารายละเอียด
// ⇒ แถวใบเงินเดือนไม่มี "อนุมัติเอกสาร"/"โพสต์" แต่มี "เปิดใบ" (ลิงก์ไปหน้ารายละเอียด)
describe('payroll row actions', () => {
  const openMenu = async () => userEvent.click(await screen.findByRole('button', { name: 'เมนู EX-001' }));

  it.each(['DRAFT', 'PENDING_APPROVAL', 'APPROVED'])('%s payroll: เปิดใบ links to the detail page, no approve or post', async (status) => {
    mount(status, 'PAYROLL'); await openMenu();
    expect(await screen.findByRole('menuitem', { name: 'เปิดใบ' })).toHaveAttribute('href', '/expenses/expense-1');
    expect(screen.queryByRole('menuitem', { name: /อนุมัติเอกสาร/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'โพสต์' })).not.toBeInTheDocument();
  });

  it('keeps approve and post on other document types', async () => {
    mount('PENDING_APPROVAL'); await openMenu();
    expect(await screen.findByRole('menuitem', { name: /อนุมัติเอกสาร/ })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'เปิดใบ' })).not.toBeInTheDocument();
  });

  it('a payroll 409 from submitting shows the server message and points to เปิดใบ', async () => {
    approvalEnabled = true;
    const message = 'ส่งขออนุมัติได้ตั้งแต่ 1 พ.ย. 2569 18:00 — รอให้ข้อมูลลงเวลาของเดือนนี้ครบก่อน ระหว่างนี้บันทึกร่างไว้ได้';
    apiPost.mockRejectedValue({ response: { status: 409, data: { code: 'PAYROLL_SUBMIT_CUTOFF', closableAt: '2026-11-01T11:00:00.000Z', message } } });
    mount('DRAFT', 'PAYROLL'); await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'ส่งขออนุมัติ' }));
    await userEvent.click(await screen.findByRole('button', { name: 'ยืนยัน' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message, { description: 'เปิดใบเพื่อดูรายละเอียด' }));
  });
});

// Task 8 fix round 1 — สถานะที่เปลี่ยนจากหน้ารายการต้องทำให้หน้ารายละเอียด/ฟอร์มแก้ไข/หน้าสลิปของใบนั้นโหลดใหม่ด้วย
describe('list-page status changes refresh that document', () => {
  it('โพสต์ from the row menu invalidates the cached detail of that document', async () => {
    apiPost.mockResolvedValue({ data: {} });
    mount();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await userEvent.click(await screen.findByRole('button', { name: 'เมนู EX-001' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'โพสต์' }));
    await userEvent.click(await screen.findByRole('button', { name: 'ยืนยัน' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/expense-documents/expense-1/post', {}));
    await waitFor(() => {
      const keys = spy.mock.calls.map(([f]) => JSON.stringify((f as { queryKey: unknown[] }).queryKey));
      expect(keys).toEqual(
        expect.arrayContaining([
          JSON.stringify(['expense-document', 'expense-1']),
          JSON.stringify(['expense-doc-edit', 'expense-1']),
          JSON.stringify(['expense-doc-voucher', 'expense-1']),
          JSON.stringify(['expenses']),
        ]),
      );
    });
  });
});
