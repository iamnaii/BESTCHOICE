import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import InboxWorkTools from './InboxWorkTools';
const mocks = vi.hoisted(() => ({
  getTarget: vi.fn(),
  markRead: vi.fn(),
  error: vi.fn(),
  enabled: true,
  queueError: false,
  role: 'SALES',
  logout: vi.fn(),
  mobile: false,
  companies: ['SHOP', 'FINANCE'] as string[],
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { role: mocks.role, name: 'สมชาย', accessibleCompanies: mocks.companies },
    logout: mocks.logout,
  }),
}));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.mobile }));
vi.mock('../../chat-analytics/ChatWorkSettingsDialog', () => ({ default: () => <div role="dialog">ตั้งค่าทดสอบ</div> }));
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
    queue: { data: undefined, isError: mocks.queueError },
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
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}
function view(select: (roomId: string) => void, url = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[url]}>
      <QueryClientProvider client={client}>
        <InboxWorkTools onSelectRoom={select} />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}
describe('Work notification targets', () => {
  beforeEach(() => {
    mocks.enabled = true;
    mocks.role = 'SALES';
    mocks.queueError = false;
    mocks.mobile = false;
    mocks.companies = ['SHOP', 'FINANCE'];
    vi.clearAllMocks();
  });
  it('lets the owner open setup from Inbox while queue is disabled', () => {
    mocks.role = 'OWNER'; mocks.enabled = false;
    view(vi.fn());
    fireEvent.click(screen.getByRole('button', { name: 'ตั้งค่างานแชท' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('ตั้งค่าทดสอบ');
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
    expect(screen.getByRole('button', { name: 'คิวงาน' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'คิวงาน' })).toHaveAccessibleDescription('คิวงานยังไม่เปิดใช้งาน');
    await waitFor(() => expect(select).toHaveBeenCalledWith('room'));
  });
  it.each([false, true])('does not announce an empty queue while its count is unknown (error=%s)', (error) => {
    mocks.queueError = error;
    view(vi.fn());
    expect(screen.getByRole('heading', { name: 'ศูนย์การสื่อสาร' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'คิวงาน' })).toHaveAccessibleDescription(
      error ? 'โหลดจำนวนงานไม่ได้ เปิดคิวงานเพื่อลองใหม่' : 'กำลังโหลดจำนวนงาน',
    );
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
/* เจ้าของเคาะ 2026-10-07 (แบบ ค): จอใหญ่ไม่มีแถบหัวและไม่มีเมนูระบบ — แถบข้าง 72px ของ inbox
   ต้องพากลับหน้าหลัก สลับหมวดงาน และออกจากระบบได้เอง · จอเล็กคงแถบหัวแบบย่อ */
describe('Inbox rail on desktop', () => {
  beforeEach(() => {
    mocks.enabled = true;
    mocks.role = 'SALES';
    mocks.queueError = false;
    mocks.mobile = false;
    mocks.companies = ['SHOP', 'FINANCE'];
    vi.clearAllMocks();
  });
  it('replaces the header with a rail: home link, chat navigation, tools and sign-out', () => {
    view(vi.fn());
    const rail = screen.getByRole('complementary', { name: 'ศูนย์การสื่อสาร' });
    expect(document.querySelector('.inbox-workspace-header')).toBeNull();
    expect(within(rail).getByRole('link', { name: 'กลับหน้าหลัก' })).toHaveAttribute('href', '/');
    const nav = within(rail).getByRole('navigation', { name: 'การสื่อสารและงานทีม' });
    expect(within(nav).getByRole('button', { name: 'แชทลูกค้า' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'คิวงาน' })).toBeEnabled();
    expect(within(nav).getByRole('button', { name: 'คอมเมนต์' })).toBeEnabled();
    expect(within(nav).getByRole('link', { name: 'ภาพรวมงานแชท' })).toHaveAttribute('href', '/chat-analytics?zone=shop');
    expect(within(rail).getByRole('button', { name: 'สลับธีม' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'การแจ้งเตือนงาน 1' })).toBeInTheDocument();
    // The page title stays in the accessibility tree even though the rail has no room to show it.
    expect(within(rail).getByRole('heading', { name: 'ศูนย์การสื่อสาร' })).toHaveClass('sr-only');
    fireEvent.click(within(rail).getByRole('button', { name: 'ออกจากระบบ' }));
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });
  it('switches the work zone inside the inbox when the user has both companies', () => {
    mocks.role = 'OWNER';
    view(vi.fn(), '/inbox/room-1?zone=shop');
    const zones = screen.getByRole('tablist', { name: 'หมวดงาน' });
    expect(within(zones).getByRole('tab', { name: 'งานหน้าร้าน (SHOP)' })).toHaveAttribute('aria-selected', 'true');
    expect(within(zones).getByRole('tab', { name: 'งานการเงิน (FINANCE)' })).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(within(zones).getByRole('tab', { name: 'งานหน้าร้าน (SHOP)' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/inbox/room-1?zone=shop');
    fireEvent.click(within(zones).getByRole('tab', { name: 'งานการเงิน (FINANCE)' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/inbox?zone=fin');
  });
  it('hides the zone switch when the user is granted a single company', () => {
    // OWNER's config lists both zones; the grant must narrow it to one.
    mocks.role = 'OWNER';
    mocks.companies = ['SHOP'];
    view(vi.fn());
    expect(screen.queryByRole('tablist', { name: 'หมวดงาน' })).toBeNull();
    expect(screen.getByText('หน้าร้าน')).toBeInTheDocument();
  });
  it('keeps the compact header on small screens', () => {
    mocks.mobile = true;
    view(vi.fn());
    expect(screen.queryByRole('complementary', { name: 'ศูนย์การสื่อสาร' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'กลับหน้าหลัก' })).toBeNull();
    expect(document.querySelector('.inbox-workspace-header')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'ศูนย์การสื่อสาร' })).not.toHaveClass('sr-only');
    expect(screen.getByRole('button', { name: 'คิวงาน' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'สลับธีม' })).toBeInTheDocument();
  });
});
