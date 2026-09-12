import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '@/lib/api';
import BulkPrintDialog from '../components/BulkPrintDialog';
import type { LetterRow } from '../types';
vi.mock('@/lib/api', () => ({ default: { post: vi.fn() } }));
vi.mock('@/hooks/useLetterPdf', () => ({ useLetterPdf: () => ({ url: 'blob:ready', loading: false, error: null, retry: vi.fn() }) }));
const row = (id: string, status: LetterRow['status'] = 'PENDING_DISPATCH'): LetterRow => ({
  id, status, letterNumber: id, contractId: id, letterType: 'CONTRACT_TERMINATION_60D', triggeredAt: '', pdfUrl: null, pdfGeneratedAt: null, dispatchedAt: null, trackingNumber: null, evidencePhotoUrl: null, deliveredAt: null, cancelledAt: null, cancelReason: null,
  contract: { id, contractNumber: id, customer: { id, name: id, phone: '', addressCurrent: null }, branch: { id, name: id } },
});
const close = vi.fn();
const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); qc.clear(); });
const view = (rows = [row('a'),row('b')]) => <QueryClientProvider client={qc}><BulkPrintDialog open rows={rows} onClose={close} /></QueryClientProvider>;

it('downloads without marking and retries only failed confirmations', async () => {
  vi.mocked(api.post).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('failure')).mockResolvedValueOnce({});
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  render(view());
  fireEvent.click(screen.getByRole('button', { name: 'ดาวน์โหลด PDF' }));
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'ยืนยันพิมพ์แล้ว' }));
  await screen.findByRole('alert');
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'ลองบันทึกอีกครั้ง 1 ฉบับ' }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(vi.mocked(api.post).mock.calls.map(call => call[0])).toEqual(['/overdue/letters/a/pdf-generated','/overdue/letters/b/pdf-generated','/overdue/letters/b/pdf-generated']);
  for (const key of ['letters','letters-counts','letter-queue']) expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
});
it('keeps the original batch through a list refresh and prevents duplicate confirmation', async () => {
  let finish!: (value: object) => void;
  vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(view([row('a')]));
  rerender(view([row('b')]));
  fireEvent.click(screen.getByRole('button', { name: 'ดาวน์โหลด PDF' }));
  const confirm = screen.getByRole('button', { name: 'ยืนยันพิมพ์แล้ว' });
  fireEvent.click(confirm); fireEvent.click(confirm);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledWith('/overdue/letters/a/pdf-generated', {});
  await act(async () => { finish({}); });
});
it('reprints already generated letters without changing their state', () => {
  render(view([row('a', 'PDF_GENERATED')]));
  fireEvent.click(screen.getByRole('button', { name: 'ดาวน์โหลด PDF' }));
  expect(screen.queryByRole('button', { name: 'ยืนยันพิมพ์แล้ว' })).not.toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});
it('does not close another dialog after an old confirmation finishes', async () => {
  let finish!: (value: object) => void;
  vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { unmount } = render(view([row('a')]));
  fireEvent.click(screen.getByRole('button', { name: 'ดาวน์โหลด PDF' }));
  fireEvent.click(screen.getByRole('button', { name: 'ยืนยันพิมพ์แล้ว' }));
  unmount();
  await act(async () => { finish({}); });
  expect(close).not.toHaveBeenCalled();
});
it('waits for the PDF frame before printing and still requires confirmation', () => {
  render(view([row('a')]));
  const button = screen.getByRole('button', { name: 'พิมพ์' });
  expect(button).toBeDisabled();
  const frame = screen.getByTitle('ตัวอย่างจดหมายรวม') as HTMLIFrameElement;
  const print = vi.spyOn(frame.contentWindow!, 'print').mockImplementation(() => {});
  fireEvent.load(frame);
  fireEvent.click(button);
  expect(print).toHaveBeenCalledTimes(1);
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'ยืนยันพิมพ์แล้ว' })).toBeVisible();
});
