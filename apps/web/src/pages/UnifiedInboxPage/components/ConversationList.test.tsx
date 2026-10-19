import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConversationList, { type InboxFilters } from './ConversationList';

const mocks = vi.hoisted(() => ({ post: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { post: mocks.post } }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock('./ConversationItem', () => ({ default: () => <div>รายการตัวอย่าง</div> }));

const initial: InboxFilters = { tab: 'waiting', channel: null, who: 'all', view: 'queue' };
function view(filters = initial, sessions: { id: string; unreadCount: number }[] = []) {
  const onFiltersChange = vi.fn();
  const onSelectRoom = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ConversationList
        sessions={sessions}
        activeRoomId={null}
        filters={filters}
        isLoading={false}
        onFiltersChange={onFiltersChange}
        onSelectRoom={onSelectRoom}
        serverCounts={{
          waiting: 41,
          mine: 1,
          all: 11848,
          expired: 582,
          byChannel: { FACEBOOK: 41 },
        }}
        connectionStatus="connected"
      />
    </QueryClientProvider>,
  );
  return { onFiltersChange, onSelectRoom };
}

describe('Compact conversation header behavior', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps search text and focus while results load or fail, and offers retry in the results', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onRetry = vi.fn();
    const onSelectRoom = vi.fn();
    const draw = (isLoading: boolean, isError = false) => <QueryClientProvider client={client}>
      <ConversationList sessions={[{ id: 'cached-room' }]} activeRoomId={null} filters={initial} isLoading={isLoading}
        isError={isError} error={new Error('offline')} onRetry={onRetry}
        onFiltersChange={vi.fn()} onSelectRoom={onSelectRoom} />
    </QueryClientProvider>;
    const { rerender } = render(draw(false));
    const input = screen.getByRole('textbox', { name: 'ค้นหาชื่อ เบอร์โทร หรือข้อความในแชท' });
    input.focus();
    fireEvent.change(input, { target: { value: 'ค้นหาข้อความต่อ' } });
    rerender(draw(true));
    expect(input).toHaveFocus();
    expect(input).toHaveValue('ค้นหาข้อความต่อ');
    fireEvent.keyDown(window, { key: 'j' });
    expect(onSelectRoom).not.toHaveBeenCalled();
    rerender(draw(false, true));
    expect(input).toHaveFocus();
    expect(input).toHaveValue('ค้นหาข้อความต่อ');
    fireEvent.keyDown(window, { key: 'k' });
    expect(onSelectRoom).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('explains an empty personal queue and offers the all view', () => {
    const { onFiltersChange } = view({ ...initial, tab: 'mine' });
    expect(screen.getByText('ยังไม่มีแชทที่คุณดูแล')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'ดูแชททั้งหมด' }));
    expect(onFiltersChange).toHaveBeenCalledWith({ ...initial, tab: 'all' });
  });

  it('shows a zero-result search instead of claiming there have never been conversations', () => {
    const { onFiltersChange } = view({ ...initial, search: 'ชื่อที่ไม่มี' });
    expect(screen.getByText(/ไม่พบผลการค้นหา/)).toHaveTextContent('ชื่อที่ไม่มี');
    expect(screen.queryByText('ยังไม่มีการสนทนา')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'ล้างการค้นหา' })[0]);
    expect(onFiltersChange).toHaveBeenCalledWith({ ...initial, search: undefined });
  });

  it('enters the expired queue without mixing it into the waiting count or dropping filters', () => {
    const filters = { ...initial, channel: 'FACEBOOK', who: 'agent' };
    const { onFiltersChange } = view(filters);
    expect(screen.getByRole('button', { name: 'รอตอบ 41 ห้อง' })).toBeVisible();
    expect(screen.getByText('ทั้งหมด 11,848 ห้อง')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'พ้นเวลาตอบ 582' }));
    expect(onFiltersChange).toHaveBeenCalledWith({ ...filters, view: 'expired' });
  });

  it('marks only loaded unread rooms read, and reports success through the existing mutation', async () => {
    mocks.post.mockResolvedValue({ data: { count: 1 } });
    const user = userEvent.setup();
    view(initial, [
      { id: 'unread-room', unreadCount: 2 },
      { id: 'read-room', unreadCount: 0 },
    ]);
    await user.click(screen.getByRole('button', { name: 'เครื่องมือกล่องข้อความ' }));
    await user.click(screen.getByRole('menuitem', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/staff-chat/rooms/read-all', {
        roomIds: ['unread-room'],
      }),
    );
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('ทำเครื่องหมายอ่านแล้ว 1 ห้อง'));
  });

  it('does not navigate rooms when j/k is pressed inside the filter dialog', async () => {
    const user = userEvent.setup();
    const { onSelectRoom } = view(initial, [{ id: 'room', unreadCount: 0 }]);
    await user.click(screen.getByRole('button', { name: 'ตัวกรองแชท' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'ผู้ดูแล' }), { key: 'j' });
    expect(onSelectRoom).not.toHaveBeenCalled();
  });
});
