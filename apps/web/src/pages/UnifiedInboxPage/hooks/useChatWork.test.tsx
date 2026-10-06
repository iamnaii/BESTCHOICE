import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useChatWork } from './useChatWork';
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: api }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u', branchId: 'b' } }),
}));
vi.mock('@/components/layout/LayoutContext', () => ({ useLayout: () => ({ workZone: 'shop' }) }));
describe('Independent chat feature flags', () => {
  it('fetches notifications while leaving the disabled queue unfetched', async () => {
    api.get.mockImplementation(async (path: string) => ({
      data: path.endsWith('work-settings')
        ? { flags: { chat_work_queue_enabled: false, chat_mentions_enabled: true } }
        : { data: [], unreadCount: 0, total: 0 },
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useChatWork('WAITING', 1), { wrapper });
    await waitFor(() => expect(result.current.inbox.isSuccess).toBe(true));
    expect(api.get.mock.calls.map((call) => call[0])).toContain('/staff-chat/work-notifications');
    expect(api.get.mock.calls.map((call) => call[0])).not.toContain('/staff-chat/work');
    unmount();
    client.clear();
  });
});
