import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { toast } from 'sonner';
import api from '@/lib/api';
import { setRequestCompany } from '@/lib/company-scope';
import { useGeneratePdf } from './usePdfExport';
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), default: { post: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const pdf = new Blob(['%PDF-report'], { type: 'application/pdf' });
function setup(done = vi.fn()) {
  const client = new QueryClient();
  const hook = renderHook(() => useGeneratePdf(done), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  return { ...hook, done };
}
beforeEach(() => { vi.clearAllMocks();setRequestCompany('FINANCE');vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:report');vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());
it('retains date filters and POST transport, blocks duplicates, and downloads exact bytes', async () => {
  let release!: () => void;
  (api.post as Mock).mockImplementation(async () => { await new Promise<void>(r => { release = r; });return { data: pdf }; });
  const { result, done } = setup(); const params={from:new Date('2026-09-01T00:00:00Z'),to:new Date('2026-09-11T00:00:00Z')};
  act(() => { result.current.generate(params);result.current.generate(params); });
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
  expect(api.post).toHaveBeenCalledWith(expect.stringContaining('from=2026-09-01T00%3A00%3A00.000Z'),undefined,expect.objectContaining({timeout:120000,responseType:'blob'}));
  await act(async () => release());await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(URL.createObjectURL).toHaveBeenCalledWith(pdf);expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
});
it('cancelling suppresses old callbacks/downloads when the dialog is reopened', async () => {
  let release!: () => void;let signal: AbortSignal | undefined;
  (api.post as Mock).mockImplementationOnce(async (_url, _data, config) => { signal=config.signal;await new Promise<void>(r=>{release=r;});return {data:pdf}; }).mockResolvedValue({data:pdf});
  const {result,done}=setup();act(()=>result.current.generate({}));await waitFor(()=>expect(api.post).toHaveBeenCalledOnce());
  act(()=>result.current.cancel());expect(signal?.aborted).toBe(true);
  act(()=>result.current.generate({}));await waitFor(()=>expect(done).toHaveBeenCalledOnce());
  await act(async()=>release());expect(done).toHaveBeenCalledOnce();expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();expect(toast.error).not.toHaveBeenCalled();
});
it('blocks report saving after a company change', async () => {
  (api.post as Mock).mockImplementation(async()=>{setRequestCompany('SHOP');return {data:pdf};});
  const {result,done}=setup();act(()=>result.current.generate({}));
  await waitFor(()=>expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('เปลี่ยนบริษัท')));
  expect(done).not.toHaveBeenCalled();expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});
