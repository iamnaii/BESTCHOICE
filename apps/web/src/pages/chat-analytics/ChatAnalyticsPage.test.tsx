import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import ChatAnalyticsPage from '../ChatAnalyticsPage';
const mocks = vi.hoisted(() => ({ get: vi.fn(), company: 'SHOP', enabled: true }));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get },
  getErrorMessage: () => 'ไม่มีสิทธิ์แล้ว',
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user', role: 'SALES', branchId: 'branch' } }),
}));
vi.mock('../UnifiedInboxPage/hooks/useChatWork', () => ({
  useChatWorkSettings: () => ({
    company: mocks.company,
    key: ['chat-work', 'user', mocks.company],
    scope: { company: mocks.company },
    settings: {
      data: { flags: { chat_analytics_v2_enabled: mocks.enabled } },
      isLoading: false,
      isError: false,
    },
  }),
}));
const view = () =>
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ChatAnalyticsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.company = 'SHOP';
  mocks.enabled = true;
  mocks.get.mockRejectedValue(new Error('ไม่มีสิทธิ์แล้ว'));
});
describe('Scoped actionable analytics', () => {
  it('uses explicit company and timezone and shows retry, never zero on request failure', async () => {
    view();
    await screen.findByRole('alert');
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        '/chat-analytics/v2/overview',
        expect.objectContaining({
          params: expect.objectContaining({
            company: 'SHOP',
            from: expect.stringMatching(/\+07:00$/),
            to: expect.stringMatching(/\+07:00$/),
          }),
        }),
      ),
    );
    expect(screen.getByRole('button', { name: 'ลองใหม่' })).toBeVisible();
    expect(screen.queryByText('0 นาที')).not.toBeInTheDocument();
  });
  it('does not call metrics while the feature flag is off', async () => {
    mocks.enabled = false;
    view();
    await screen.findByText('ยังไม่เปิดรายงานงานแชท');
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
