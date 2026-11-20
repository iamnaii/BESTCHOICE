import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useChatDispatch } from './useChatDispatch';
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: api }));
const paused = {
  enabled: true,
  ready: false,
  generation: null,
  expiresAt: null,
  position: null,
  readyCount: 0,
};
const ready = {
  ...paused,
  ready: true,
  generation: 'session-a',
  expiresAt: '2099-01-01',
  position: 2,
  readyCount: 3,
};
function setup(enabled = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ company, on }: { company: 'SHOP' | 'FINANCE'; on: boolean }) =>
      useChatDispatch(company, ['chat-work', 'u', company], on),
    { initialProps: { company: 'SHOP', on: enabled }, wrapper },
  );
  return {
    ...hook,
    cleanup: () => {
      hook.unmount();
      client.clear();
    },
  };
}
describe('Staff readiness lifecycle', () => {
  it('keeps a delayed SHOP join response in SHOP after switching to FINANCE', async () => {
    const hook = setup();
    await waitFor(() => expect(hook.result.current.query.isSuccess).toBe(true));
    let complete!: (value: { data: typeof ready }) => void;
    api.patch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    act(() => hook.result.current.readiness.mutate(true));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    hook.rerender({ company: 'FINANCE', on: true });
    await waitFor(() => expect(hook.result.current.query.isSuccess).toBe(true));
    await act(async () => {
      complete({ data: ready });
    });
    await waitFor(() => expect(hook.result.current.readiness.isSuccess).toBe(true));
    expect(hook.result.current.query.data?.ready).toBe(false);
    expect(hook.result.current.query.data?.generation).toBeNull();
    hook.cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ data: paused });
  });
  it('only fetches/renews when routing is enabled and a ready session exists', async () => {
    const hook = setup(false);
    expect(api.get).not.toHaveBeenCalled();
    hook.rerender({ company: 'SHOP', on: true });
    await waitFor(() => expect(hook.result.current.query.isSuccess).toBe(true));
    expect(api.post).not.toHaveBeenCalled();
    api.get.mockResolvedValue({ data: ready });
    api.post.mockResolvedValue({ data: ready });
    await act(async () => {
      await hook.result.current.query.refetch();
    });
    expect(api.post).toHaveBeenCalledWith(
      '/staff-chat/dispatch/heartbeat',
      { generation: 'session-a' },
      expect.objectContaining({ params: { company: 'SHOP' } }),
    );
    hook.cleanup();
  });
  it('joins and pauses with server-confirmed state, and does not carry readiness across company scopes', async () => {
    const hook = setup();
    await waitFor(() => expect(hook.result.current.query.isSuccess).toBe(true));
    api.patch.mockResolvedValueOnce({ data: ready });
    await act(async () => {
      await hook.result.current.readiness.mutateAsync(true);
    });
    await waitFor(() => expect(hook.result.current.query.data?.position).toBe(2));
    api.patch.mockResolvedValueOnce({ data: paused });
    await act(async () => {
      await hook.result.current.readiness.mutateAsync(false);
    });
    await waitFor(() => expect(hook.result.current.query.data?.ready).toBe(false));
    hook.rerender({ company: 'FINANCE', on: true });
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/staff-chat/dispatch',
        expect.objectContaining({ params: { company: 'FINANCE' } }),
      ),
    );
    expect(hook.result.current.query.data?.ready).not.toBe(true);
    hook.cleanup();
  });
});
