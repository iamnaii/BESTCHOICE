import { StrictMode, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { useRoomMessages } from './useRoomMessages';
import { useRoomNotes } from './useRoomNotes';
import { useRoomActions } from './useRoomActions';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.delete },
}));
vi.mock('sonner', () => ({
  toast: { success: mocks.success, error: mocks.error, warning: mocks.warning },
}));
vi.mock('react-router', () => ({ useNavigate: () => mocks.navigate }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({ data: [] });
  mocks.post.mockResolvedValue({ data: {} });
  mocks.patch.mockResolvedValue({ data: {} });
  mocks.delete.mockResolvedValue({ data: {} });
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </StrictMode>
  );
  return { client, invalidate, wrapper };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it('does not fetch or send without an active room', async () => {
  const { wrapper } = setup();
  const { result } = renderHook(() => useRoomMessages(null, 'connected'), { wrapper });
  await act(async () => {
    expect(await result.current.handleSendMessage('hello')).toBe(false);
  });
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
});

it('keeps a pending send with its originating room and reconciles only that room and token', async () => {
  const { wrapper, client, invalidate } = setup();
  const pending = deferred<{ data: Record<string, never> }>();
  mocks.post.mockReturnValue(pending.promise);
  const { result, rerender } = renderHook(({ room }) => useRoomMessages(room, 'connected'), {
    initialProps: { room: 'A' },
    wrapper,
  });
  act(() => {
    void result.current.handleSendMessage('hello');
  });
  const token = mocks.post.mock.calls[0][1].clientMessageId;
  expect(result.current.pendingSends).toEqual([
    { roomId: 'A', text: 'hello', clientMessageId: token },
  ]);
  rerender({ room: 'B' });
  await act(async () => {
    pending.resolve({ data: {} });
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['chat-messages', 'A'] });
  act(() => {
    client.setQueryData(['chat-messages', 'B'], [{ clientMessageId: token }]);
  });
  expect(result.current.pendingSends).toHaveLength(1);
  act(() => {
    client.setQueryData(['chat-messages', 'A'], [{ clientMessageId: token }]);
  });
  rerender({ room: 'A' });
  await waitFor(() => expect(result.current.pendingSends).toHaveLength(0));
});

it('shows a rejected send and retries once with the same token under StrictMode', async () => {
  const { wrapper } = setup();
  mocks.post.mockResolvedValueOnce({ data: { success: false, error: 'Delivery failed' } });
  const { result } = renderHook(() => useRoomMessages('A', 'connected'), { wrapper });
  await act(async () => {
    expect(await result.current.handleSendMessage('hello')).toBe(false);
  });
  const token = mocks.post.mock.calls[0][1].clientMessageId;
  expect(result.current.pendingSends).toHaveLength(0);
  expect(result.current.failedSends).toHaveLength(1);
  const failure = result.current.failedSends[0];
  await act(async () => result.current.retrySend(failure.id, failure.text));
  expect(mocks.post).toHaveBeenCalledTimes(2);
  expect(mocks.post.mock.calls[1]).toEqual([
    '/staff-chat/rooms/A/messages',
    { text: 'hello', clientMessageId: token },
  ]);
  expect(result.current.failedSends).toHaveLength(0);
});

it('merges WS-first and HTTP failures without losing the original retry token or useful reason', async () => {
  const { wrapper } = setup();
  const pending = deferred<{ data: Record<string, never> }>();
  mocks.post.mockReturnValueOnce(pending.promise);
  const { result } = renderHook(() => useRoomMessages('A', 'connected'), { wrapper });
  act(() => {
    void result.current.handleSendMessage('hello');
  });
  const token = mocks.post.mock.calls[0][1].clientMessageId;
  act(() => result.current.pushFailedSend('A', 'hello', 'ws', '', 'เหตุจาก LINE'));
  await act(async () => pending.reject(new Error('network failed')));
  expect(result.current.failedSends).toHaveLength(1);
  expect(result.current.failedSends[0]).toMatchObject({
    roomId: 'A',
    clientMessageId: token,
    reason: 'เหตุจาก LINE',
  });
  await act(async () => result.current.retrySend(result.current.failedSends[0].id, 'hello'));
  expect(mocks.post.mock.calls[1][1].clientMessageId).toBe(token);
});

it('finishes an upload for its original room and reuses the file token on retry', async () => {
  const { wrapper, invalidate } = setup();
  const pending = deferred<{ data: { delivered: boolean } }>();
  mocks.post.mockReturnValueOnce(pending.promise).mockResolvedValue({ data: { delivered: true } });
  const { result, rerender } = renderHook(({ room }) => useRoomMessages(room, 'connected'), {
    initialProps: { room: 'A' },
    wrapper,
  });
  const file = new File(['image'], 'proof.png', { type: 'image/png' });
  act(() => result.current.handleSendFile(file));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
  const first = mocks.post.mock.calls[0][1] as FormData;
  expect(first.get('file')).toBe(file);
  rerender({ room: 'B' });
  await act(async () => pending.resolve({ data: { delivered: true } }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['chat-messages', 'A'] });
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['chat-messages', 'B'] });
  rerender({ room: 'A' });
  act(() => result.current.handleSendFile(file));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
  expect(mocks.post.mock.calls[1][1].get('clientMessageId')).toBe(first.get('clientMessageId'));
});

it('invalidates the note room after switching to a different conversation', async () => {
  const { wrapper, invalidate } = setup();
  const pending = deferred<{ data: Record<string, never> }>();
  mocks.post.mockReturnValueOnce(pending.promise);
  const { result, rerender } = renderHook(({ room }) => useRoomNotes(room), {
    initialProps: { room: 'A' },
    wrapper,
  });
  act(() => result.current.addNoteMutation.mutate({ roomId: 'A', content: 'internal note' }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith('/staff-chat/rooms/A/notes', {
      content: 'internal note',
    }),
  );
  rerender({ room: 'B' });
  await act(async () => pending.resolve({ data: {} }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['chat-notes', 'A'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['chat-room', 'A'] });
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['chat-notes', 'B'] });
});

it.each([
  ['pinNoteMutation', 'patch', '/staff-chat/rooms/A/notes/note/pin'],
  ['unpinNoteMutation', 'delete', '/staff-chat/rooms/A/notes/note/pin'],
  ['deleteNoteMutation', 'delete', '/staff-chat/rooms/A/notes/note'],
] as const)(
  '%s preserves its endpoint and refreshes notes and room',
  async (name, method, path) => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useRoomNotes('A'), { wrapper });
    await act(async () => result.current[name].mutateAsync({ roomId: 'A', noteId: 'note' }));
    expect(mocks[method]).toHaveBeenCalledWith(path);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['chat-notes', 'A'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['chat-room', 'A'] });
  },
);

it.each(['assignMutation', 'transferMutation'] as const)(
  '%s refreshes its original room after switching',
  async (name) => {
    const { wrapper, invalidate } = setup();
    const pending = deferred<{ data: Record<string, never> }>();
    mocks.patch.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(
      ({ room }) => useRoomActions(room, [{ id: 'A' }, { id: 'B' }], false),
      { initialProps: { room: 'A' }, wrapper },
    );
    act(() => result.current[name].mutate({ roomId: 'A', staffId: 'staff' }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledOnce());
    rerender({ room: 'B' });
    await act(async () => pending.resolve({ data: {} }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['chat-room', 'A'] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['chat-room', 'B'] });
    if (name === 'transferMutation')
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['staff-online'] });
  },
);

it('resolves to the next room and undo reopens the original room', async () => {
  const { wrapper } = setup();
  const { result } = renderHook(
    () => useRoomActions('B', [{ id: 'A' }, { id: 'B' }, { id: 'C' }], false),
    { wrapper },
  );
  await act(async () => result.current.resolveMutation.mutateAsync('B'));
  expect(mocks.navigate).toHaveBeenCalledWith('/inbox/C');
  const undo = mocks.success.mock.calls.find(([text]) => text === 'ปิดแชทแล้ว')![1].action.onClick;
  await act(async () => undo());
  expect(mocks.patch).toHaveBeenCalledWith('/staff-chat/rooms/B/reopen');
  expect(mocks.navigate).toHaveBeenLastCalledWith('/inbox/B');
});

it('does not navigate away from a new room when an earlier resolve completes', async () => {
  const { wrapper } = setup();
  const pending = deferred<{ data: Record<string, never> }>();
  mocks.patch.mockReturnValueOnce(pending.promise);
  const { result, rerender } = renderHook(
    ({ room }) => useRoomActions(room, [{ id: 'A' }, { id: 'B' }], false),
    { initialProps: { room: 'A' }, wrapper },
  );
  act(() => result.current.resolveMutation.mutate('A'));
  await waitFor(() => expect(mocks.patch).toHaveBeenCalledOnce());
  rerender({ room: 'B' });
  await act(async () => pending.resolve({ data: {} }));
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it('preserves distinct AI toggle and return-to-bot/undo endpoints', async () => {
  const { wrapper } = setup();
  const { result, rerender } = renderHook(
    ({ paused }) => useRoomActions('A', [{ id: 'A' }], paused),
    { initialProps: { paused: false }, wrapper },
  );
  await act(async () => result.current.handleToggleAi());
  expect(mocks.post).toHaveBeenCalledWith('/chat-ai/take-over/A');
  rerender({ paused: true });
  await act(async () => result.current.handleToggleAi());
  expect(mocks.post).toHaveBeenCalledWith('/chat-ai/release-to-ai/A');
  await act(async () => result.current.returnToAIMutation.mutateAsync('A'));
  expect(mocks.patch).toHaveBeenCalledWith('/staff-chat/rooms/A/return-to-ai');
  const undo = mocks.success.mock.calls.find(([text]) => text === 'ส่งกลับ Bot แล้ว')![1].action
    .onClick;
  await act(async () => undo());
  expect(mocks.post.mock.calls.filter(([path]) => path === '/chat-ai/take-over/A')).toHaveLength(2);
});
