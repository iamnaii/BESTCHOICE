import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CHAT_WORK_FLAGS } from '@installment/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatWorkSettingsDialog from './ChatWorkSettingsDialog';

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), close: vi.fn() }));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, patch: mocks.patch },
  getErrorMessage: () => 'บันทึกไม่สำเร็จ ลองอีกครั้ง',
}));
vi.mock('../UnifiedInboxPage/hooks/useChatWork', () => ({
  useChatWorkSettings: () => ({
    company: 'SHOP',
    key: ['chat-work', 'user', 'SHOP'],
    scope: { company: 'SHOP' },
  }),
}));
vi.mock('../UnifiedInboxPage/components/FacebookCommentPageSettings', () => ({
  default: () => <div>ตั้งค่า Page และสาขา</div>,
}));
const setup = async () => {
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ChatWorkSettingsDialog onClose={mocks.close} />
    </QueryClientProvider>,
  );
  await screen.findByRole('switch', { name: 'คิวงานแชท' });
  return user;
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({
    data: {
      flags: Object.fromEntries(CHAT_WORK_FLAGS.map((key) => [key, false])),
      policy: { ownerMinutes: 5, managerMinutes: 15 },
    },
  });
  mocks.patch.mockResolvedValue({ data: {} });
});
describe('Chat work settings', () => {
  it('enables the queue with round robin and turns routing off when the queue is disabled', async () => {
    const user = await setup();
    const routing = screen.getByRole('switch', { name: 'แจกแชทให้พนักงานตามคิว' });
    const queue = screen.getByRole('switch', { name: 'คิวงานแชท' });
    await user.click(routing);
    expect(queue).toBeChecked(); expect(routing).toBeChecked();
    await user.click(queue);
    expect(queue).not.toBeChecked(); expect(routing).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'บันทึกการตั้งค่า' })).toBeDisabled();
  });
  it('keeps edits across tabs and saves only changed flags with the policy', async () => {
    const user = await setup();
    expect(screen.getByRole('button', { name: 'บันทึกการตั้งค่า' })).toBeDisabled();
    await user.click(screen.getByRole('switch', { name: 'คิวงานแชท' }));
    await user.click(screen.getByRole('tab', { name: 'Facebook' }));
    await user.click(screen.getByRole('switch', { name: 'คอมเมนต์ Facebook' }));
    expect(mocks.patch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('tab', { name: 'งานแชท' }));
    expect(screen.getByRole('switch', { name: 'คิวงานแชท' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'บันทึกการตั้งค่า' }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/staff-chat/work-settings', {
        ownerMinutes: 5,
        managerMinutes: 15,
        flags: [
          { key: 'chat_work_queue_enabled', enabled: true },
          { key: 'chat_facebook_comments_enabled', enabled: true },
        ],
      }),
    );
    await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
  });
  it('returns to invalid timing fields even when saving from another tab', async () => {
    const user = await setup();
    await user.click(screen.getByRole('tab', { name: 'แจ้งเตือน' }));
    const owner = screen.getByRole('spinbutton', { name: 'เตือนผู้ดูแลเมื่อรอ (นาที)' });
    await user.clear(owner);
    await user.type(owner, '20');
    await user.click(screen.getByRole('tab', { name: 'งานแชท' }));
    await user.click(screen.getByRole('button', { name: 'บันทึกการตั้งค่า' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'เวลาเตือนหัวหน้าต้องไม่น้อยกว่าเวลาเตือนผู้ดูแล',
    );
    expect(screen.getByRole('tab', { name: 'แจ้งเตือน' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('spinbutton', { name: 'เตือนหัวหน้าเมื่อรอ (นาที)' })).toHaveFocus();
    expect(mocks.patch).not.toHaveBeenCalled();
  });
  it('retains edits after a save failure and can retry', async () => {
    const user = await setup();
    mocks.patch.mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('switch', { name: 'ติดตามการขาย' }));
    await user.click(screen.getByRole('button', { name: 'บันทึกการตั้งค่า' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('บันทึกไม่สำเร็จ');
    expect(screen.getByRole('switch', { name: 'ติดตามการขาย' })).toBeChecked();
    expect(mocks.close).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'บันทึกการตั้งค่า' }));
    await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
  });
  it('cancels without saving', async () => {
    const user = await setup();
    await user.click(screen.getByRole('switch', { name: 'คิวงานแชท' }));
    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.patch).not.toHaveBeenCalled();
  });
});
