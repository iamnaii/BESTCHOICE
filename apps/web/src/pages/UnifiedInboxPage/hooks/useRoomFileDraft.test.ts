import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useRoomFileDraft } from './useRoomFileDraft';

it('stages without sending, retains failures for retry, and removes only successful files', async () => {
  const first = new File(['photo'], 'first.png', { type: 'image/png' });
  const second = new File(['photo'], 'second.png', { type: 'image/png' });
  const upload = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValue(true);
  const { result } = renderHook(() => useRoomFileDraft('a'));
  act(() => result.current.add([first, second]));
  expect(upload).not.toHaveBeenCalled();
  await act(() => result.current.send(upload));
  expect(result.current.files).toEqual([second]);
  await act(() => result.current.send(upload));
  expect(upload.mock.calls.map(call => call[0])).toEqual([first, second, second]);
  expect(result.current.files).toEqual([]);
});

it('a pending batch stays with its original room while another room keeps its draft', async () => {
  const first = new File(['a'], 'a.png', { type: 'image/png' });
  const next = new File(['a2'], 'a2.png', { type: 'image/png' });
  const other = new File(['b'], 'b.png', { type: 'image/png' });
  let finish!: (ok: boolean) => void;
  const upload = vi.fn().mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; })).mockResolvedValue(true);
  const { result, rerender } = renderHook(({ room }) => useRoomFileDraft(room), { initialProps: { room: 'a' } });
  act(() => result.current.add([first, next]));
  let sending!: Promise<void>;
  act(() => { sending = result.current.send(upload); });
  rerender({ room: 'b' });
  act(() => result.current.add([other]));
  await act(async () => { finish(true); await sending; });
  expect(upload.mock.calls.map(call => call[0])).toEqual([first, next]);
  expect(result.current.files).toEqual([other]);
  rerender({ room: 'a' });
  expect(result.current.files).toEqual([]);
});
