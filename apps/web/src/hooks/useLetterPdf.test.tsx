import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import api from '@/lib/api';
import { setRequestCompany } from '@/lib/company-scope';
import { useLetterPdf } from './useLetterPdf';
vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), default: { get: vi.fn() } }));
const create = vi.fn((_blob: Blob) => 'blob:letter');
const revoke = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); setRequestCompany('FINANCE');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const onePdf = async () => { const pdf = await PDFDocument.create(); pdf.addPage([595,842]); return (await pdf.save()).buffer; };

it('merges every page in selection order and releases its URL on unmount', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: await onePdf() });
  const { result, unmount } = renderHook(() => useLetterPdf(['a','b'], true));
  await waitFor(() => expect(result.current.url).toBe('blob:letter'));
  const blob = create.mock.calls[0][0] as unknown as Blob;
  expect((await PDFDocument.load(await blob.arrayBuffer())).getPageCount()).toBe(2);
  expect(vi.mocked(api.get).mock.calls.map(call => call[0])).toEqual(['/overdue/letters/a/pdf','/overdue/letters/b/pdf']);
  unmount(); expect(revoke).toHaveBeenCalledWith('blob:letter');
});
it('aborts a closed preview and ignores late bytes', async () => {
  let finish!: (value: { data: ArrayBuffer }) => void;
  vi.mocked(api.get).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { unmount } = renderHook(() => useLetterPdf(['a'], true));
  const signal = vi.mocked(api.get).mock.calls[0][1]?.signal;
  unmount(); expect(signal?.aborted).toBe(true);
  await act(async () => { finish({ data: new ArrayBuffer(8) }); });
  expect(create).not.toHaveBeenCalled();
});
it('discards a response if company changes away and back while loading', async () => {
  vi.mocked(api.get).mockImplementation(async () => { setRequestCompany('SHOP'); setRequestCompany('FINANCE'); return { data: new ArrayBuffer(8) }; });
  const { unmount } = renderHook(() => useLetterPdf(['a','b'], true));
  await act(async () => { await Promise.resolve(); });
  expect(create).not.toHaveBeenCalled(); expect(api.get).toHaveBeenCalledTimes(1);
  unmount();
});
it('shows a failed load and retries the same selected letter', async () => {
  vi.mocked(api.get).mockRejectedValueOnce({ response: { data: { message: 'โหลดไม่สำเร็จ' } } }).mockResolvedValueOnce({ data: await onePdf() });
  const { result } = renderHook(() => useLetterPdf(['a'], true));
  await waitFor(() => expect(result.current.error).toBe('โหลดไม่สำเร็จ'));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.url).toBe('blob:letter'));
  expect(result.current.error).toBeNull();
});
it('releases the old preview and ignores an obsolete selection response', async () => {
  let finish!: (value: { data: ArrayBuffer }) => void;
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ data: await onePdf() });
  const { result, rerender } = renderHook(({ ids }) => useLetterPdf(ids, true), { initialProps: { ids: ['a'] } });
  rerender({ ids: ['b'] });
  await waitFor(() => expect(result.current.url).toBe('blob:letter'));
  await act(async () => { finish({ data: new ArrayBuffer(8) }); });
  expect(create).toHaveBeenCalledTimes(1);
});
it('reopens a mounted preview with fresh bytes and a new owned URL', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: await onePdf() });
  create.mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
  const { result, rerender } = renderHook(({ enabled }) => useLetterPdf(['a'], enabled), { initialProps: { enabled: true } });
  await waitFor(() => expect(result.current.url).toBe('blob:first'));
  rerender({ enabled: false });
  expect(result.current.url).toBeNull();expect(revoke).toHaveBeenCalledWith('blob:first');
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.url).toBe('blob:second'));
  expect(api.get).toHaveBeenCalledTimes(2);
});
it('uses the archived public file without forwarding credentials or regenerating its contents', async () => {
  const bytes = await onePdf();
  const fetchArchive = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => bytes });
  vi.stubGlobal('fetch', fetchArchive);
  const { result } = renderHook(() => useLetterPdf(['a'], true, { a: 'https://files.example.invalid/letters/original.pdf' }));
  await waitFor(() => expect(result.current.url).toBe('blob:letter'));
  expect(api.get).not.toHaveBeenCalled();
  expect(fetchArchive).toHaveBeenCalledWith('https://files.example.invalid/letters/original.pdf', expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }));
  const blob = create.mock.calls[0][0];
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array(bytes));
});
it('never regenerates an archived letter when its file cannot be read', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  const { result } = renderHook(() => useLetterPdf(['a'], true, { a: 'https://files.example.invalid/letters/original.pdf' }));
  await waitFor(() => expect(result.current.error).toContain('ไฟล์เดิม'));
  expect(api.get).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
});
