import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { setRequestCompany } from '@/lib/company-scope';
import PdfPreview from './PdfPreview';

vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), default: { get: vi.fn() } }));
const pdf = new Blob(['%PDF-test'], { type: 'application/pdf' });
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><PdfPreview path="/expense-documents/doc/voucher.pdf" filename="ใบสำคัญจ่าย.pdf" title="ตัวอย่าง" onClose={vi.fn()} /></QueryClientProvider>);
  return { ...view, client };
}
beforeEach(() => { vi.clearAllMocks(); setRequestCompany('SHOP'); vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pdf'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());
it('shows loading, retries an error, waits for the iframe, and uses the same bytes for preview/download/print', async () => {
  let fail!: () => void;
  vi.mocked(api.get).mockImplementationOnce(async () => { await new Promise<void>(r => { fail = r; }); throw { response: { status: 503, data: { message: 'เครื่องสร้างเอกสารไม่พร้อม' } } }; }).mockResolvedValue({ data: pdf });
  const view = setup(); expect(screen.getByRole('status')).toHaveTextContent('กำลังเตรียมเอกสาร');
  await act(async () => fail());
  expect(await screen.findByRole('alert')).toHaveTextContent('เครื่องสร้างเอกสารไม่พร้อม');
  fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
  const download = await screen.findByRole('link', { name: 'ดาวน์โหลด PDF' });
  expect(download).toHaveAttribute('href', 'blob:pdf');expect(download).toHaveAttribute('download','ใบสำคัญจ่าย.pdf');
  expect(URL.createObjectURL).toHaveBeenCalledWith(pdf);
  const frame = screen.getByTitle('ใบสำคัญจ่าย.pdf') as HTMLIFrameElement;
  const print = vi.fn(); Object.defineProperty(frame, 'contentWindow', { value: { print }, configurable: true });
  const button = screen.getByRole('button', { name: 'พิมพ์' }); expect(button).toBeDisabled();
  fireEvent.load(frame); fireEvent.click(button);expect(print).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pdf');
  await waitFor(() => expect(view.client.getQueryCache().getAll()).toHaveLength(0));
});
it('cancels closed previews and ignores late bytes without affecting a newly opened preview', async () => {
  let release!: () => void;let signal: AbortSignal | undefined;
  vi.mocked(api.get).mockImplementationOnce(async (_path, config) => { signal = config?.signal as AbortSignal; await new Promise<void>(r => { release = r; }); return { data: pdf }; }).mockResolvedValue({ data: pdf });
  const first = setup();await waitFor(() => expect(api.get).toHaveBeenCalledOnce());first.unmount();expect(signal?.aborted).toBe(true);
  const second = setup();await screen.findByRole('link',{name:'ดาวน์โหลด PDF'});
  await act(async () => release());expect(URL.createObjectURL).toHaveBeenCalledTimes(1);expect(URL.revokeObjectURL).not.toHaveBeenCalled();second.unmount();
});
it('refuses results and retry after a company switch away and back', async () => {
  vi.mocked(api.get).mockImplementation(async () => { setRequestCompany('FINANCE'); setRequestCompany('SHOP'); return { data: pdf }; });
  setup();expect(await screen.findByRole('alert')).toHaveTextContent('เปลี่ยนบริษัท');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'ลองใหม่'})).not.toBeInTheDocument();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
