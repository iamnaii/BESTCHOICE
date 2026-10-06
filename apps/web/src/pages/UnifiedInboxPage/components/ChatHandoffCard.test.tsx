import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ChatHandoffCard from './ChatHandoffCard';
const mocks = vi.hoisted(() => ({
  api: { get: vi.fn(), patch: vi.fn() },
  user: { id: 'receiver', role: 'SALES' },
}));
vi.mock('@/lib/api', () => ({ default: mocks.api, getErrorMessage: () => 'บันทึกไม่ได้' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../hooks/useChatWork', () => ({
  useChatWorkSettings: () => ({
    company: 'SHOP',
    scope: { company: 'SHOP' },
    key: ['chat-work', mocks.user.id, 'SHOP'],
  }),
}));
const task = {
  id: 'task',
  roomId: 'room',
  title: 'ตรวจข้อมูล',
  workKind: 'CHAT_HANDOFF',
  revision: 0,
  status: 'TODO',
  assigneeId: 'receiver',
  assignee: { name: 'บี' },
  createdById: 'sender',
  createdBy: { name: 'เอ' },
};
const view = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <ChatHandoffCard taskId="task" />
    </QueryClientProvider>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.id = 'receiver';
  mocks.user.role = 'SALES';
  mocks.api.get.mockImplementation((url: string) =>
    Promise.resolve({ data: url.endsWith('/comments') ? [] : task }),
  );
});
describe('Handoff actions', () => {
  it('opening does not accept; assignee explicitly accepts with the current revision', async () => {
    view();
    await screen.findByText('ผู้รับงาน: บี');
    expect(mocks.api.patch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'จบงาน' })).not.toBeInTheDocument();
    mocks.api.patch.mockResolvedValue({ data: { ...task, status: 'DOING', revision: 1 } });
    fireEvent.click(screen.getByRole('button', { name: 'รับงาน' }));
    await waitFor(() =>
      expect(mocks.api.patch).toHaveBeenCalledWith(
        '/staff-chat/handoffs/task',
        { expectedRevision: 0, action: 'ACCEPT' },
        expect.anything(),
      ),
    );
  });
  it('creator can cancel but cannot accept for the receiver', async () => {
    mocks.user.id = 'sender';
    view();
    await screen.findByRole('button', { name: 'ยกเลิกงาน' });
    expect(screen.queryByRole('button', { name: 'รับงาน' })).not.toBeInTheDocument();
  });
  it('retains completion draft on conflict and waits for explicit refresh', async () => {
    mocks.api.get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.endsWith('/comments') ? [] : { ...task, status: 'DOING', revision: 1 },
      }),
    );
    mocks.api.patch.mockRejectedValue({ response: { status: 409 } });
    view();
    fireEvent.change(await screen.findByLabelText('ผลการทำงาน'), {
      target: { value: 'ตรวจเสร็จแล้ว' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'จบงาน' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('ผลการทำงาน')).toHaveValue('ตรวจเสร็จแล้ว');
    expect(screen.getByRole('button', { name: 'จบงาน' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'โหลดสถานะล่าสุด' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'จบงาน' })).toBeEnabled());
  });
});
