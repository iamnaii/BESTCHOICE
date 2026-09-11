import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import api from '@/lib/api';
import { setRequestCompany } from '@/lib/company-scope';
import DocumentDownloadButton from './DocumentDownloadButton';

vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), default: { get: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
const pdf = new Blob(['%PDF-test'], { type: 'application/pdf' });
function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><DocumentDownloadButton path="/receipts/r1/pdf" filename="ใบเสร็จ.pdf">ดาวน์โหลด</DocumentDownloadButton></QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); setRequestCompany('SHOP'); vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });
it('blocks immediate double click, keeps the file alive and restores the button after download', async () => {
  let release!: () => void;
  vi.mocked(api.get).mockImplementation(async () => { await new Promise<void>(r => { release = r; }); return { data: pdf }; });
  setup(); const button = screen.getByRole('button');
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  expect(button).toBeDisabled(); expect(button).toHaveAttribute('aria-busy', 'true');
  await act(async () => release());
  await waitFor(() => expect(button).toBeEnabled());
  expect(URL.createObjectURL).toHaveBeenCalledWith(pdf);
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});
it('does not save an obsolete result after unmount even if transport ignores abort', async () => {
  let release!: () => void; let signal: AbortSignal | undefined;
  vi.mocked(api.get).mockImplementation(async (_path, config) => { signal = config?.signal as AbortSignal; await new Promise<void>(r => { release = r; }); return { data: pdf }; });
  const view = setup(); fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(api.get).toHaveBeenCalledOnce()); view.unmount();
  expect(signal?.aborted).toBe(true); await act(async () => release());
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled();
});
it('blocks a company switch away and back and allows retry', async () => {
  vi.mocked(api.get).mockImplementationOnce(async () => { setRequestCompany('FINANCE'); setRequestCompany('SHOP'); return { data: pdf }; }).mockResolvedValue({ data: pdf });
  setup();fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('เปลี่ยนบริษัท')));
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
});
