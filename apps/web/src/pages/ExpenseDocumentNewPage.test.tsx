import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExpenseDocumentNewPage from './ExpenseDocumentNewPage';
const mocks = vi.hoisted(() => ({ get: vi.fn(), user: { branchId: null as string | null } }));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/components/expense-form-v4/ExpenseFormV4', () => ({
  ExpenseFormV4: ({ branchId, initialDocType, editDocId, onDraftSaved }: { branchId: string; initialDocType?: string; editDocId?: string; onDraftSaved?: (id: string) => void }) =>
    <div>
      <div data-testid="expense-form">{branchId} / {initialDocType} / {editDocId}</div>
      <button type="button" onClick={() => onDraftSaved?.('new-1')}>บันทึกร่าง + คิดยอด</button>
    </div>,
}));
function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }
function open(path = '/expenses/new') {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}><ExpenseDocumentNewPage /><Location /></MemoryRouter>
  </QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); mocks.user.branchId = null; });
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
});
