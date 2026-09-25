import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, it, expect, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
const get = vi.fn(); const post = vi.fn(); const patch = vi.fn(); const del = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), delete: (...a: unknown[]) => del(...a) },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { useFinanceApplication } from './useFinanceApplication';
const wrap = (qc: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
const draft = { id: 'a1', number: 'BC-1', status: 'DRAFT', roomId: 'A', customerId: null, productId: null, files: [], events: [] };
beforeEach(() => { get.mockReset(); post.mockReset(); patch.mockReset(); del.mockReset(); });

it('loads current + history for the room and exposes the preview only when a draft exists', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockImplementation((url: string) => {
    if (url === '/staff-chat/rooms/A/finance-applications') return Promise.resolve({ data: { current: draft, history: [] } });
    if (url === '/finance-applications/a1/message-preview') return Promise.resolve({ data: { text: 'x', missingFields: ['occupation'], missingRequiredSlots: [], warnings: [], canSend: false } });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  const { result } = renderHook(() => useFinanceApplication('A'), { wrapper: wrap(qc) });
  await waitFor(() => expect(result.current.current?.id).toBe('a1'));
  await waitFor(() => expect(result.current.preview?.missingFields).toEqual(['occupation']));
  expect(result.current.step).toBe(1);
});

it('start() posts a draft, attachMessage() posts from-message with the slot, and both invalidate the room query', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  get.mockResolvedValue({ data: { current: null, history: [] } });
  post.mockResolvedValue({ data: draft });
  const { result } = renderHook(() => useFinanceApplication('A'), { wrapper: wrap(qc) });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => { await result.current.start(); });
  expect(post).toHaveBeenCalledWith('/staff-chat/rooms/A/finance-applications');
  get.mockResolvedValue({ data: { current: draft, history: [] } });
  await waitFor(() => expect(result.current.current?.id).toBe('a1'));
  await act(async () => { await result.current.attachMessage('m1', 'INCOME'); });
  expect(post).toHaveBeenCalledWith('/finance-applications/a1/files/from-message', { messageId: 'm1', slot: 'INCOME' }, expect.objectContaining({ timeout: 120000 }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['room-gfin', 'A'] });
});

it('send(COPY) returns the message text so the caller can copy it, and marks busy while pending', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockResolvedValue({ data: { current: { ...draft, customerId: 'c', productId: 'p' }, history: [] } });
  post.mockResolvedValue({ data: { application: { ...draft, status: 'SENT' }, messageText: 'ข้อความ', shareUrl: 'https://x/api/g/t' } });
  const { result } = renderHook(() => useFinanceApplication('A'), { wrapper: wrap(qc) });
  await waitFor(() => expect(result.current.current?.id).toBe('a1'));
  let out: { messageText: string; shareUrl: string } | undefined;
  await act(async () => { out = await result.current.send('COPY'); });
  expect(out?.messageText).toBe('ข้อความ');
  expect(post).toHaveBeenCalledWith('/finance-applications/a1/send', { via: 'COPY' });
  expect(result.current.busy).toBe(false);
});
