import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { PaymentApprovalPermissionsCard } from './PaymentApprovalPermissionsCard';

let role = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));
vi.mock('@/lib/api', () => ({ default: { get: vi.fn(), put: vi.fn() }, getErrorMessage: String }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const users = [
  { id: 'owner', name: 'เจ้าของ', role: 'OWNER', permissions: [] },
  { id: 'manager', name: 'ผู้จัดการ', role: 'BRANCH_MANAGER', permissions: [] },
];
beforeEach(() => {
  role = 'OWNER';
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({ data: { users } });
  vi.mocked(api.put).mockResolvedValue({ data: { users } });
});
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PaymentApprovalPermissionsCard />
    </QueryClientProvider>,
  );
  return vi.spyOn(client, 'invalidateQueries');
}
it('keeps owner rights locked, allows branch-manager payment grants and preserves save/invalidation', async () => {
  const invalidate = show();
  const owner = await screen.findByRole('checkbox', { name: 'เจ้าของ: ยกเว้นค่าปรับ' });
  expect(owner).toBeChecked();
  expect(owner).toBeDisabled();
  const grant = screen.getByRole('checkbox', { name: 'ผู้จัดการ: อนุมัติคืนเงินเข้าบัญชี' });
  expect(grant).toBeEnabled();
  fireEvent.click(grant);
  fireEvent.click(screen.getByRole('button', { name: 'บันทึกสิทธิ์' }));
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/payments/approval-settings', {
      users: [
        { userId: 'owner', permissions: [] },
        { userId: 'manager', permissions: ['REFUND'] },
      ],
    }),
  );
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['payment-approval-requests'] }),
  );
});
it('does not expose or fetch grants for non-owners', () => {
  role = 'BRANCH_MANAGER';
  show();
  expect(api.get).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
