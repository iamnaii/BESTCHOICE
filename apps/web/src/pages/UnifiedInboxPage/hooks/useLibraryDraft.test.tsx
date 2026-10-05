import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useLibraryDraft } from './useLibraryDraft';
const post = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ default: { post }, getErrorMessage: () => 'ส่งไม่สำเร็จ' }));
const file = {
  id: 'file-a',
  name: 'ตัวอย่าง.pdf',
  mimeType: 'application/pdf',
  size: 100,
  company: 'SHOP' as const,
  branchId: null,
  folderId: null,
  createdAt: '',
};
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);
beforeEach(() => post.mockReset());
it('selection stages only, preserves stable tokens on retry and never resends confirmed/unknown files', async () => {
  const { result } = renderHook(() => useLibraryDraft('room-a', 'SHOP', true, 'chat'), { wrapper });
  act(() => result.current.add([file]));
  expect(post).not.toHaveBeenCalled();
  post.mockImplementationOnce((_url, body) =>
    Promise.resolve({ data: [{ ...body.items[0], status: 'FAILED' }] }),
  );
  await act(() => result.current.send());
  const token = post.mock.calls[0][1].items[0].requestKey;
  post.mockImplementationOnce((_url, body) =>
    Promise.resolve({ data: [{ ...body.items[0], status: 'UNKNOWN' }] }),
  );
  await act(() => result.current.send());
  expect(post.mock.calls[1][1].items[0].requestKey).toBe(token);
  await act(() => result.current.send());
  expect(post).toHaveBeenCalledTimes(2);
  expect(result.current.items[0].status).toBe('UNKNOWN');
});
it('notes cannot send; switching room hides old selection and returning restores it', async () => {
  const { result, rerender } = renderHook(
    ({ room, active }) => useLibraryDraft(room, 'SHOP', active, 'chat'),
    { wrapper, initialProps: { room: 'room-a', active: true } },
  );
  act(() => result.current.add([file]));
  rerender({ room: 'room-a', active: false });
  await act(() => result.current.send());
  expect(post).not.toHaveBeenCalled();
  rerender({ room: 'room-b', active: true });
  expect(result.current.items).toHaveLength(0);
  rerender({ room: 'room-a', active: true });
  expect(result.current.items).toHaveLength(1);
  post.mockImplementationOnce((_url, body) =>
    Promise.resolve({ data: [{ ...body.items[0], status: 'SENT' }] }),
  );
  await act(() => result.current.send());
  await waitFor(() => expect(result.current.items[0].status).toBe('SENT'));
  await act(() => result.current.send());
  expect(post).toHaveBeenCalledTimes(1);
});
it('lost HTTP response retains its token for verification and cannot be removed/reselected as a new send',async()=>{
 const {result}=renderHook(()=>useLibraryDraft('room-a','SHOP',true,'chat'),{wrapper});
 act(()=>result.current.add([file]));post.mockRejectedValueOnce(new Error('timeout'));
 await act(()=>result.current.send());const token=post.mock.calls[0][1].items[0].requestKey;
 act(()=>result.current.remove(token));expect(result.current.items).toHaveLength(1);
 post.mockImplementationOnce((_url,body)=>Promise.resolve({data:[{...body.items[0],status:'SENT'}]}));
 await act(()=>result.current.send());expect(post.mock.calls[1][1].items[0].requestKey).toBe(token);
});
