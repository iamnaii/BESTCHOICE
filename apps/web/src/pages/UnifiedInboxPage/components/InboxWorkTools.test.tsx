import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import InboxWorkTools from './InboxWorkTools';
const mocks = vi.hoisted(() => ({
  getTarget: vi.fn(),
  markRead: vi.fn(),
  error: vi.fn(),
  enabled: true,
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
vi.mock('../hooks/useChatWork', () => ({
  useChatWork: () => ({
    company: 'SHOP',
    key: ['chat-work', 'user', 'SHOP'],
    identity: 'user:SHOP',
    enabled: mocks.enabled,
    settings: {
      isError: false,
      data: { flags: { chat_mentions_enabled: true, chat_facebook_comments_enabled: true } },
    },
    queue: { data: undefined },
    inbox: {
      data: {
        unreadCount: 1,
        total: 1,
        data: [
          {
            id: 'n',
            title: 'มีโน้ตถึงคุณ',
            targetType: 'NOTE',
            targetId: 'note',
            roomId: 'room',
            createdAt: '2026-10-06T00:00:00Z',
            readAt: null,
          },
        ],
      },
    },
    getTarget: mocks.getTarget,
    markRead: mocks.markRead,
  }),
}));
function view(select: (roomId: string) => void, url = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[url]}>
      <QueryClientProvider client={client}>
        <InboxWorkTools onSelectRoom={select} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}
describe('Work notification targets', () => {
  beforeEach(() => {
    mocks.enabled = true;
    vi.clearAllMocks();
  });
  it('keeps comments, notifications and note deep links available when only queue is disabled', async () => {
    mocks.enabled = false;
    const id = '00000000-0000-4000-8000-000000000001';
    mocks.getTarget.mockResolvedValue({
      roomId: 'room',
      targetId: id,
      targetType: 'NOTE',
      title: 'โน้ตภายใน',
      content: 'linked note',
    });
    const select = vi.fn();
    view(select, `/?noteId=${id}`);
    expect(screen.getByRole('button', { name: 'คอมเมนต์' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'การแจ้งเตือนงาน 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'คิวงาน' })).not.toBeInTheDocument();
    await waitFor(() => expect(select).toHaveBeenCalledWith('room'));
  });
  it('refuses navigation and read mutation when target permission is gone', async () => {
    mocks.getTarget.mockRejectedValueOnce(new Error('not found'));
    const select = vi.fn();
    view(select);
    fireEvent.click(screen.getByRole('button', { name: 'การแจ้งเตือนงาน 1' }));
    fireEvent.click(screen.getByRole('button', { name: /มีโน้ตถึงคุณ/ }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(select).not.toHaveBeenCalled();
    expect(mocks.markRead).not.toHaveBeenCalled();
  });
  it('opens the exact authorized note and marks only that notification read', async () => {
    mocks.getTarget.mockResolvedValue({
      roomId: 'room',
      targetId: 'note',
      targetType: 'NOTE',
      title: 'โน้ตภายใน',
      content: 'ตรวจเอกสารก่อนโทร',
    });
    mocks.markRead.mockResolvedValueOnce({});
    const select = vi.fn();
    view(select);
    fireEvent.click(screen.getByRole('button', { name: 'การแจ้งเตือนงาน 1' }));
    fireEvent.click(screen.getByRole('button', { name: /มีโน้ตถึงคุณ/ }));
    await waitFor(() => expect(select).toHaveBeenCalledWith('room'));
    expect(mocks.getTarget).toHaveBeenLastCalledWith('NOTE', 'note');
    expect(mocks.markRead).toHaveBeenCalledWith('n');
    expect(await screen.findByText('ตรวจเอกสารก่อนโทร')).toBeInTheDocument();
  });
  it('removes an open note snapshot after a deletion or access change', async () => {
    mocks.getTarget.mockResolvedValue({
      roomId: 'room',
      targetId: 'note',
      targetType: 'NOTE',
      title: 'โน้ตภายใน',
      content: 'เนื้อหาที่ต้องหายหลังลบ',
    });
    mocks.markRead.mockResolvedValue({});
    const client = view(vi.fn());
    fireEvent.click(screen.getByRole('button', { name: 'การแจ้งเตือนงาน 1' }));
    fireEvent.click(screen.getByRole('button', { name: /มีโน้ตถึงคุณ/ }));
    await screen.findByText('เนื้อหาที่ต้องหายหลังลบ');
    mocks.getTarget.mockRejectedValue(new Error('deleted'));
    await client.invalidateQueries({ queryKey: ['chat-work'] });
    await screen.findByRole('alert');
    expect(screen.queryByText('เนื้อหาที่ต้องหายหลังลบ')).not.toBeInTheDocument();
  });
});
