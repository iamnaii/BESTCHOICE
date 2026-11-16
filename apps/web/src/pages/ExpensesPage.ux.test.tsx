import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { openCombobox, pickComboOption } from '@/test/combobox';

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
const authUser = vi.hoisted(() => ({ current: { id: 'u-acc', role: 'ACCOUNTANT', branchId: null as string | null } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: authUser.current }) }));
vi.mock('@/hooks/useAccountingPermissions', () => ({ useAccountingPermissions: () => ({ can: () => allowed }) }));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({
  paginationSize: 20, templatesEnabled: false, approvalEnabled,
  approvalThreshold: 1000, approvalRequiredDocTypes: [], reverseReasons: [], reverseReasonRequired: false,
}) }));
const coaGroups = vi.hoisted(() => ({ current: [] as { category: string; accounts: { code: string; name: string }[] }[] }));
vi.mock('@/hooks/useCoa', () => ({ useCoaGroups: () => ({ data: { groups: coaGroups.current } }) }));
vi.mock('@/components/accounting/ReopenedPeriodBanner', () => ({ ReopenedPeriodBanner: () => null }));
vi.mock('@/components/expense-form-v4/ExpenseFormV4', () => ({ ExpenseFormV4: () => <div aria-label="สร้างรายจ่ายใหม่" /> }));
import ExpensesPage from './ExpensesPage';

let queryClient: QueryClient;
function LocationProbe() { const l = useLocation(); return <output data-testid="location">{l.pathname + l.search}</output>; }
function StateProbe() { const l = useLocation(); return <output data-testid="state">{JSON.stringify(l.state)}</output>; }
function mount(status = 'DRAFT', documentType = 'EXPENSE', path = '/expenses') {
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
    <MemoryRouter initialEntries={[path]}><ExpensesPage /><LocationProbe /></MemoryRouter>
  </QueryClientProvider>);
}
const trigger = () => screen.getByRole('button', { name: 'เมนู EX-001' });
beforeEach(() => {
  apiGet.mockReset(); apiPost.mockReset(); approvalEnabled = false; allowed = true; coaGroups.current = [];
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
  // คำตัดสินเจ้าของ 2026-10-28 — ผู้จัดการสาขาเปิดดูใบเงินเดือนได้ แต่แก้/ส่ง/ยกเลิกไม่ได้
  it('a branch manager gets only เปิดใบ on a payroll draft — no แก้ไข / ส่งขออนุมัติ / ยกเลิก', async () => {
    authUser.current = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'b1' };
    try {
      mount('DRAFT', 'PAYROLL'); await userEvent.click(await screen.findByRole('button', { name: 'เมนู EX-001' }));
      await screen.findByRole('menu');
      expect(screen.queryByRole('menuitem', { name: 'แก้ไข' })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /ส่งขออนุมัติ/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'ยกเลิก' })).not.toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /เปิดใบ/ })).toBeInTheDocument();
    } finally {
      authUser.current = { id: 'u-acc', role: 'ACCOUNTANT', branchId: null };
    }
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

describe('สร้างเอกสารใหม่', () => {
  it('รายจ่าย (EX) พาไปหน้าเต็มพร้อมสาขาที่กรองอยู่ ไม่เปิด dialog', async () => {
    const user = userEvent.setup();
    apiGet.mockImplementation((path: string) => Promise.resolve({ data: path.startsWith('/expense-documents?') ? { data: [], total: 0 } : [] }));
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/expenses?branch=branch-1']}><ExpensesPage /><LocationProbe /></MemoryRouter>
    </QueryClientProvider>);
    await user.click(await screen.findByRole('button', { name: /สร้างเอกสารใหม่/ }));
    await user.click(screen.getByRole('button', { name: 'รายจ่าย (EX)' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses/new?branch=branch-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('แก้ไขใบเงินเดือนจากรายการที่กรองอยู่ ส่งตัวกรองไปกับหน้าแก้ไข', async () => {
    const row = { id: 'expense-1', number: 'EX-001', status: 'DRAFT', documentType: 'PAYROLL', vendorName: 'ผู้ขายตัวอย่าง',
      branchId: 'branch-1', branch: { id: 'branch-1', name: 'สาขาตัวอย่าง' },
      documentDate: '2026-10-19', createdAt: '2026-10-19', totalAmount: '1000', netPayment: '1000', expenseDetail: { lines: [] },
    };
    apiGet.mockImplementation((path: string) => Promise.resolve({ data:
      path.startsWith('/expense-documents?') ? { data: [row], total: 1 }
      : path.includes('/summary') ? { totalCount: 1, byStatus: {}, accrualUnpaidCount: 0, accrualUnpaidTotal: '0' } : [],
    }));
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/expenses?branch=branch-1']}><ExpensesPage /><LocationProbe /><StateProbe /></MemoryRouter>
    </QueryClientProvider>);
    await userEvent.click(await screen.findByRole('button', { name: 'เมนู EX-001' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'แก้ไข' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses/new?edit=expense-1');
    expect(screen.getByTestId('state')).toHaveTextContent('"listSearch":"?branch=branch-1"');
  });
});

// R2-4c — ตัวกรอง "ประเภทค่าใช้จ่าย" เป็นช่องค้นหา (กลุ่มตามหมวดบัญชีแทน optgroup) · ส่งรหัสบัญชีใน ?category= เหมือนเดิม
describe('expense category filter', () => {
  beforeEach(() => {
    coaGroups.current = [
      { category: 'OpEx-สถานที่', accounts: [{ code: '53-1301', name: 'ค่าเช่า (สำนักงาน)' }, { code: '53-1302', name: 'ค่าโทรศัพท์และอินเทอร์เน็ต' }] },
      { category: 'OpEx-วิชาชีพ', accounts: [{ code: '53-1501', name: 'ค่าทำบัญชี' }] },
    ];
  });

  it('lists ทุกประเภท and the accounts under their category; picking one filters the list by its code', async () => {
    const user = userEvent.setup(); mount();
    expect(screen.getByRole('combobox', { name: 'ประเภทค่าใช้จ่าย' })).toHaveTextContent('ทุกประเภท');
    const list = await openCombobox(user, 'ประเภทค่าใช้จ่าย');
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['ทุกประเภท', '53-1301 - ค่าเช่า', '53-1302 - ค่าโทรศัพท์และอินเทอร์เน็ต', '53-1501 - ค่าทำบัญชี']);
    expect(within(list).getByText('OpEx-วิชาชีพ')).toBeInTheDocument();
    await user.click(within(list).getByRole('option', { name: '53-1302 - ค่าโทรศัพท์และอินเทอร์เน็ต' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses?category=53-1302&page=1');
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringMatching(/^\/expense-documents\?.*category=53-1302/)));
  });

  it('ทุกประเภท removes the category from the URL', async () => {
    const user = userEvent.setup(); mount('DRAFT', 'EXPENSE', '/expenses?category=53-1302');
    expect(screen.getByRole('combobox', { name: 'ประเภทค่าใช้จ่าย' })).toHaveTextContent('53-1302 - ค่าโทรศัพท์และอินเทอร์เน็ต');
    await pickComboOption(user, 'ประเภทค่าใช้จ่าย', 'ทุกประเภท');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/expenses\?page=1$/);
  });

  it('picking the current type again keeps the page (a native select fired no change)', async () => {
    const user = userEvent.setup(); mount('DRAFT', 'EXPENSE', '/expenses?category=53-1302&page=3');
    await pickComboOption(user, 'ประเภทค่าใช้จ่าย', '53-1302 - ค่าโทรศัพท์และอินเทอร์เน็ต');
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses?category=53-1302&page=3');
  });
});
