import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExpenseDocumentNewPage from './ExpenseDocumentNewPage';
const mocks = vi.hoisted(() => ({ get: vi.fn(), user: { branchId: null as string | null, role: 'ACCOUNTANT' as string } }));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
let formInstances = 0;
vi.mock('@/components/expense-form-v4/ExpenseFormV4', () => ({
  ExpenseFormV4: ({ branchId, initialDocType, editDocId, onDraftSaved, onSaved }: { branchId: string; initialDocType?: string; editDocId?: string; onDraftSaved?: (id: string) => void; onSaved?: () => void }) => {
    const [instance] = useState(() => ++formInstances);
    return (<div>
      <div data-testid="instance">{instance}</div>
      <div data-testid="expense-form">{branchId} / {initialDocType} / {editDocId}</div>
      <button type="button" onClick={() => onDraftSaved?.('new-1')}>บันทึกร่าง + คิดยอด</button>
      <button type="button" onClick={() => onSaved?.()}>บันทึก</button>
    </div>);
  },
}));
function StateProbe() { const l = useLocation(); return <output data-testid="state">{JSON.stringify(l.state)}</output>; }
function Location() { const l = useLocation(); return <output data-testid="location">{l.pathname + l.search}</output>; }
function open(path: string | { pathname: string; search?: string; state?: unknown } = '/expenses/new') {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}><ExpenseDocumentNewPage /><Location /><StateProbe /></MemoryRouter>
  </QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); formInstances = 0; mocks.user.branchId = null; });
describe('expense creation branch resolution', () => {
  it('waits for branches instead of redirecting on direct navigation', async () => {
    let resolve!: (value: { data: { id: string; name: string }[] }) => void;
    mocks.get.mockReturnValue(new Promise((done) => { resolve = done; }));
    open('/expenses/new?type=CN');
    expect(screen.getByRole('status', { name: 'กำลังโหลด' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses/new');
    resolve({ data: [{ id: 'branch-a', name: 'สาขาทดสอบ' }] });
    expect(await screen.findByTestId('expense-form')).toHaveTextContent('branch-a / CREDIT_NOTE');
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses/new');
  });
  it('shows an error with retry and recovers', async () => {
    mocks.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [{ id: 'branch-b' }] });
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดสาขาไม่สำเร็จ');
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(await screen.findByTestId('expense-form')).toHaveTextContent('branch-b');
  });
  it('explains an empty branch list and permits reloading', async () => {
    mocks.get.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [{ id: 'branch-c' }] });
    open();
    expect(await screen.findByText('ยังไม่มีสาขาที่ใช้สร้างค่าใช้จ่ายได้')).toBeInTheDocument();
    expect(screen.queryByTestId('expense-form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'โหลดใหม่' }));
    expect(await screen.findByTestId('expense-form')).toHaveTextContent('branch-c');
  });
  it('a payroll draft saved with บันทึกร่าง + คิดยอด reopens on its edit route', () => {
    mocks.user.branchId = 'assigned'; mocks.get.mockReturnValue(new Promise(() => {}));
    open('/expenses/new?type=PR');
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกร่าง + คิดยอด' }));
    expect(screen.getByTestId('expense-form')).toHaveTextContent('assigned / PAYROLL / new-1');
  });
  it('preserves the assigned branch and payroll edit mode', () => {
    mocks.user.branchId = 'assigned'; mocks.get.mockReturnValue(new Promise(() => {}));
    open('/expenses/new?edit=draft-1');
    expect(screen.getByTestId('expense-form')).toHaveTextContent('assigned / PAYROLL / draft-1');
  });

  it('a branch manager opening a payroll edit link gets the notice and a link to the document, not the form', () => {
    mocks.user.branchId = 'assigned'; mocks.user.role = 'BRANCH_MANAGER'; mocks.get.mockReturnValue(new Promise(() => {}));
    try {
      open('/expenses/new?edit=draft-1');
      expect(screen.queryByTestId('expense-form')).not.toBeInTheDocument();
      expect(screen.getByText('ใบเงินเดือนทำได้เฉพาะเจ้าของ ฝ่ายบัญชี และผู้จัดการการเงิน')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'เปิดใบ' })).toBeInTheDocument();
    } finally {
      mocks.user.role = 'ACCOUNTANT';
    }
  });

  it('?branch= ที่อยู่ในรายการสาขา ใช้สาขานั้น แม้ผู้ใช้มีสาขาประจำ', async () => {
    mocks.user.branchId = 'assigned';
    mocks.get.mockResolvedValue({ data: [{ id: 'assigned', name: 'ก' }, { id: 'branch-x', name: 'ข' }] });
    open('/expenses/new?branch=branch-x');
    expect(await screen.findByTestId('expense-form')).toHaveTextContent('branch-x');
  });
  it('?branch= ที่ไม่อยู่ในรายการ ถูกเมิน', async () => {
    mocks.user.branchId = 'assigned';
    mocks.get.mockResolvedValue({ data: [{ id: 'assigned', name: 'ก' }] });
    open('/expenses/new?branch=someone-else');
    expect(await screen.findByTestId('expense-form')).toHaveTextContent('assigned');
  });
  it('มี ?branch= แต่รายการสาขายังไม่มา ยังไม่แสดงฟอร์ม', () => {
    mocks.user.branchId = 'assigned';
    mocks.get.mockReturnValue(new Promise(() => {}));
    open('/expenses/new?branch=branch-x');
    expect(screen.queryByTestId('expense-form')).not.toBeInTheDocument();
  });
  it('บันทึกแล้วกลับหน้ารายการพร้อมตัวกรองเดิม', async () => {
    mocks.user.branchId = 'assigned'; mocks.get.mockReturnValue(new Promise(() => {}));
    open({ pathname: '/expenses/new', state: { listSearch: '?tab=accrual&branch=b1' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses?tab=accrual&branch=b1');
  });
  it('เปิดตรง ๆ ไม่มี state บันทึกแล้วกลับ /expenses', () => {
    mocks.user.branchId = 'assigned'; mocks.get.mockReturnValue(new Promise(() => {}));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/expenses$/);
  });
  it('หลังบันทึกร่างใบเงินเดือนครั้งแรก ฟอร์มเดิมยังอยู่ และ ?branch= กับตัวกรองรายการไม่หาย', async () => {
    mocks.user.branchId = 'assigned';
    mocks.get.mockResolvedValue({ data: [{ id: 'assigned', name: 'ก' }, { id: 'branch-x', name: 'ข' }] });
    open({ pathname: '/expenses/new', search: '?type=PR&branch=branch-x', state: { listSearch: '?tab=accrual&branch=branch-x' } });
    await screen.findByTestId('expense-form');
    const before = screen.getByTestId('instance').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกร่าง + คิดยอด' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses/new?branch=branch-x&edit=new-1');
    expect(screen.getByTestId('expense-form')).toHaveTextContent('branch-x / PAYROLL / new-1');
    expect(screen.getByTestId('instance').textContent).toBe(before);
    expect(screen.getByTestId('state')).toHaveTextContent('"listSearch":"?tab=accrual&branch=branch-x"');
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses?tab=accrual&branch=branch-x');
  });
});
