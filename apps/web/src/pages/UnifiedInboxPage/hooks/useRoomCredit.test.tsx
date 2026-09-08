import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, it, expect, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));
import { useRoomCredit } from './useRoomCredit';
beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

it('uploads real multipart files without auto-analysis and invalidates the original room after switching', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  get.mockResolvedValue({ data: { files: [], analysis: null } });
  let resolve!: (value: unknown) => void;
  post.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const attached = vi.fn();
  const { result, rerender } = renderHook(({ roomId }) => useRoomCredit(roomId, attached), {
    initialProps: { roomId: 'A' },
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.upload([new File(['jpeg'], 'statement.jpg', { type: 'image/jpeg' })]));
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect(post.mock.calls[0][2]).toMatchObject({
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  expect(post.mock.calls[0][1]).toBeInstanceOf(FormData);
  rerender({ roomId: 'B' });
  await act(async () => resolve({ data: {} }));
  await waitFor(() => expect(attached).toHaveBeenCalledWith('A'));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['room-credit', 'A'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['customers'] });
  expect(result.current.roomId).toBe('B');
  expect(post).toHaveBeenCalledTimes(1);
});

it('opens the panel for successful files in a mixed batch while retaining the failed-file explanation', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockResolvedValue({ data: { files: [], analysis: null } });
  post.mockResolvedValue({ data: {} });
  const attached = vi.fn();
  const { result } = renderHook(() => useRoomCredit('A', attached), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() =>
    result.current.upload([
      new File(['jpeg'], 'statement.jpg', { type: 'image/jpeg' }),
      new File(['heic'], 'second.heic', { type: 'image/heic' }),
    ]),
  );
  await waitFor(() => expect(result.current.error).toContain('HEIC'));
  expect(attached).toHaveBeenCalledWith('A');
  expect(post).toHaveBeenCalledTimes(1);
});
