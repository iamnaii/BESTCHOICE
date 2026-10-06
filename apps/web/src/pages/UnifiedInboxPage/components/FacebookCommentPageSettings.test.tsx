import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FacebookCommentPageSettings from './FacebookCommentPageSettings';
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  role: 'OWNER',
  enabled: false,
  company: 'SHOP',
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: mocks.role } }) }));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, patch: mocks.patch, post: mocks.post },
  getErrorMessage: () => 'ทดสอบล้มเหลว',
}));
vi.mock('../hooks/useChatWork', () => ({
  useChatWorkSettings: () => ({
    scope: { company: mocks.company },
    key: ['chat-work', mocks.company],
    settings: { data: { flags: { chat_facebook_comments_enabled: mocks.enabled } } },
  }),
}));
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <FacebookCommentPageSettings />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}
async function open() {
  fireEvent.click(screen.getByText('ตั้งค่า Page และสาขา'));
  await screen.findByText('Page: 123');
}
describe('Facebook readiness setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = 'OWNER';
    mocks.enabled = false;
    mocks.company = 'SHOP';
    mocks.get.mockResolvedValue({
      data: {
        pageId: '123',
        binding: { branchId: 'branch', enabled: true },
        branches: [{ id: 'branch', name: 'สาขาทดสอบ' }],
        capabilities: {
          receive: false,
          publicReply: false,
          privateReply: false,
          reason: 'ยังไม่สมัคร feed',
          checks: [
            { key: 'pages_manage_metadata', label: 'สิทธิ์จัดการเหตุการณ์', passed: true },
            { key: 'feed', label: 'สมัคร feed แล้ว', passed: false },
          ],
        },
      },
    });
    mocks.post.mockResolvedValue({ data: {} });
    mocks.patch.mockResolvedValue({ data: {} });
  });
  it.each([
    ['SALES', 'SHOP'],
    ['OWNER', 'FINANCE'],
  ])('hides setup from %s in %s', (role, company) => {
    mocks.role = role;
    mocks.company = company;
    show();
    expect(screen.queryByText('ตั้งค่า Page และสาขา')).not.toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('checks lazily even when comments are disabled; reads do not subscribe or enable anything', async () => {
    show();
    expect(mocks.get).not.toHaveBeenCalled();
    await open();
    expect(screen.getByLabelText('สถานะคอมเมนต์')).toHaveTextContent('ยังไม่พร้อม');
    expect(screen.getByRole('link', { name: 'ตั้งค่าการเชื่อมต่อ Facebook' })).toHaveAttribute(
      'href',
      '/settings/integrations/hub',
    );
    expect(screen.getByText('ยังไม่รองรับตอบส่วนตัว', { exact: false })).toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
  });
  it('requires an explicit subscription click, scopes it, blocks double submit and refreshes readiness', async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.post.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    show();
    await open();
    const button = screen.getByRole('button', { name: 'สมัครรับคอมเมนต์จาก Facebook' });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('button', { name: 'กำลังสมัคร…' })).toBeDisabled());
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith(
      '/staff-chat/facebook-comments/page-config/subscribe-feed',
      {},
      { params: { company: 'SHOP' } },
    );
    await act(async () => finish({ data: {} }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  });
  it('binding save never subscribes and keeps the global feature switch independent', async () => {
    show();
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกและเปิดคิวของ Page' }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        '/staff-chat/facebook-comments/page-config',
        { branchId: 'branch', enabled: true },
        { params: { company: 'SHOP' } },
      ),
    );
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('reports unverified state after a failed refresh, instead of showing stale readiness', async () => {
    show();
    await open();
    mocks.get.mockRejectedValue(new Error('network'));
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสิทธิ์กับ Meta อีกครั้ง' }));
    await screen.findByRole('alert');
    expect(screen.queryByLabelText('สถานะคอมเมนต์')).not.toBeInTheDocument();
  });
});
