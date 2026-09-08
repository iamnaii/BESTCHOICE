import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountingPermissionsCard } from '@/pages/SettingsPage/components/AccountingPermissionsCard';
import { ACCOUNTING_PERMISSIONS, ACCOUNTING_PERMISSION_LABELS, type AccountingPermission } from '@/lib/accounting-permissions';

let currentUser: { id: string; role: string } | null;
const apiGet = vi.fn(); const apiPut = vi.fn(); const success = vi.fn(); const error = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: currentUser }) }));
vi.mock('@/lib/api', () => ({ default: { get: (...args: unknown[]) => apiGet(...args), put: (...args: unknown[]) => apiPut(...args) }, getErrorMessage: (value: unknown) => String(value) }));
vi.mock('sonner', () => ({ toast: { success: (...args: unknown[]) => success(...args), error: (...args: unknown[]) => error(...args) } }));

const rows = () => [
  { id: 'owner', name: 'เจ้าของ', role: 'OWNER', permissions: [] as AccountingPermission[] },
  { id: 'accountant', name: 'พนักงานบัญชี', role: 'ACCOUNTANT', permissions: ['INCOME_APPROVE'] as AccountingPermission[] },
  { id: 'manager', name: 'ผู้จัดการสาขา', role: 'BRANCH_MANAGER', permissions: [] as AccountingPermission[] },
];
const clients: QueryClient[] = [];
function showCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const view = render(<QueryClientProvider client={client}><AccountingPermissionsCard /></QueryClientProvider>);
  return { ...view, client, invalidate };
}
const checkbox = (name: string, permission: AccountingPermission) => screen.getByRole('checkbox', { name: `${name}: ${ACCOUNTING_PERMISSION_LABELS[permission]}` });

beforeEach(() => {
  currentUser = { id: 'owner', role: 'OWNER' };
  apiGet.mockReset().mockResolvedValue({ data: { users: rows() } });
  apiPut.mockReset().mockImplementation(async (_url, body: { users: { userId: string; permissions: AccountingPermission[] }[] }) => ({
    data: { users: rows().map((row) => ({ ...row, permissions: body.users.find((entry) => entry.userId === row.id)?.permissions ?? [] })) },
  }));
  success.mockClear(); error.mockClear();
});
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); });

describe('AccountingPermissionsCard', () => {
  it.each(['ACCOUNTANT', 'FINANCE_MANAGER', 'BRANCH_MANAGER'])('does not fetch or display permission settings to %s', (role) => {
    currentUser = { id: 'viewer', role }; const { container } = showCard();
    expect(container).toBeEmptyDOMElement(); expect(apiGet).not.toHaveBeenCalled();
  });

  it('keeps OWNER rights checked and locked and restricts branch managers to expense permissions', async () => {
    showCard(); await screen.findByRole('checkbox', { name: 'เจ้าของ: รายจ่าย: บันทึก & POST' });
    for (const permission of ACCOUNTING_PERMISSIONS) {
      expect(checkbox('เจ้าของ', permission)).toBeChecked();
      expect(checkbox('เจ้าของ', permission)).toBeDisabled();
      expect(checkbox('ผู้จัดการสาขา', permission)).not.toBeChecked();
      if (permission.startsWith('INCOME_')) expect(checkbox('ผู้จัดการสาขา', permission)).toBeDisabled();
      else expect(checkbox('ผู้จัดการสาขา', permission)).toBeEnabled();
    }
    expect(checkbox('พนักงานบัญชี', 'INCOME_APPROVE')).toBeChecked();
    expect(checkbox('พนักงานบัญชี', 'INCOME_POST')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'บันทึกสิทธิ์' })).toBeDisabled();
  });

  it('sends explicit per-user grants, preserves other rights, and invalidates active permissions', async () => {
    const { invalidate } = showCard(); await screen.findByRole('checkbox', { name: 'พนักงานบัญชี: รายจ่าย: บันทึก & POST' });
    fireEvent.click(checkbox('พนักงานบัญชี', 'EXPENSE_POST'));
    fireEvent.click(checkbox('ผู้จัดการสาขา', 'EXPENSE_CANCEL'));
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกสิทธิ์' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/accounting-permissions', { users: [
      { userId: 'owner', permissions: [] },
      { userId: 'accountant', permissions: ['EXPENSE_POST', 'INCOME_APPROVE'] },
      { userId: 'manager', permissions: ['EXPENSE_CANCEL'] },
    ] }));
    await waitFor(() => expect(success).toHaveBeenCalledOnce());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['accounting-permissions', 'me'] });
    expect(screen.getByRole('button', { name: 'บันทึกสิทธิ์' })).toBeDisabled();
  });

  it('discards unsaved edits without sending a request', async () => {
    showCard(); await screen.findByRole('checkbox', { name: 'พนักงานบัญชี: รายรับ: อนุมัติ' });
    fireEvent.click(checkbox('พนักงานบัญชี', 'INCOME_APPROVE'));
    expect(checkbox('พนักงานบัญชี', 'INCOME_APPROVE')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิกการแก้ไข' }));
    expect(checkbox('พนักงานบัญชี', 'INCOME_APPROVE')).toBeChecked();
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('keeps edits reviewable after a failed save and permits retry', async () => {
    apiPut.mockRejectedValueOnce(new Error('permission update failed'));
    showCard(); await screen.findByRole('checkbox', { name: 'พนักงานบัญชี: รายจ่าย: ยกเลิก' });
    fireEvent.click(checkbox('พนักงานบัญชี', 'EXPENSE_CANCEL'));
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกสิทธิ์' }));
    await waitFor(() => expect(error).toHaveBeenCalledWith('Error: permission update failed'));
    expect(success).not.toHaveBeenCalled();
    expect(checkbox('พนักงานบัญชี', 'EXPENSE_CANCEL')).toBeChecked();
    expect(screen.getByRole('button', { name: 'บันทึกสิทธิ์' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกสิทธิ์' }));
    await waitFor(() => expect(success).toHaveBeenCalledOnce());
  });

  it('shows a retryable load failure without allowing an empty replacement to be saved', async () => {
    apiGet.mockRejectedValueOnce(new Error('settings unavailable'));
    showCard(); expect(await screen.findByRole('alert')).toHaveTextContent('settings unavailable');
    expect(screen.getByRole('button', { name: 'บันทึกสิทธิ์' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    await screen.findByRole('checkbox', { name: 'พนักงานบัญชี: รายรับ: อนุมัติ' });
    expect(apiPut).not.toHaveBeenCalled();
  });
});
