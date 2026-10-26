import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => apiPost(...args) },
  api: { post: (...args: unknown[]) => apiPost(...args) },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/PdfPreview', () => ({
  __esModule: true,
  default: ({ path, filename, title }: { path: string; filename: string; title: string }) => (
    <div data-testid="pdf-preview" data-path={path} data-filename={filename}>{title}</div>
  ),
}));

import { toast } from 'sonner';
import SaleReceiptActions, { lineResultMessage, receiptFilename, receiptPdfPath, type SaleReceiptActionsSale } from '../SaleReceiptActions';

const cashSale: SaleReceiptActionsSale = { id: 's1', saleNumber: 'SL-1', saleType: 'CASH', deletedAt: null };

function renderActions(sale: Partial<SaleReceiptActionsSale> & { saleType: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SaleReceiptActions sale={{ ...cashSale, ...sale }} />
    </QueryClientProvider>,
  );
}

describe('SaleReceiptActions', () => {
  beforeEach(() => {
    apiPost.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it('opens the PDF preview for the sale receipt', () => {
    renderActions({ saleType: 'CASH' });
    fireEvent.click(screen.getByRole('button', { name: 'พิมพ์ใบเสร็จ' }));
    const preview = screen.getByTestId('pdf-preview');
    expect(preview).toHaveAttribute('data-path', '/sales/s1/receipt.pdf');
    expect(preview).toHaveAttribute('data-filename', 'ใบเสร็จ-SL-1.pdf');
  });

  it('sends the receipt via LINE and reports success', async () => {
    apiPost.mockResolvedValue({ data: { delivered: true } });
    renderActions({ saleType: 'CASH' });
    fireEvent.click(screen.getByRole('button', { name: 'ส่ง LINE' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/sales/s1/receipt/line'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('ส่งใบเสร็จทาง LINE แล้ว'));
  });

  it('tells the staff to copy the link instead when the customer has no LINE', async () => {
    apiPost.mockResolvedValue({ data: { delivered: false, reason: 'NO_LINE_LINK' } });
    renderActions({ saleType: 'CASH' });
    fireEvent.click(screen.getByRole('button', { name: 'ส่ง LINE' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('ลูกค้ายังไม่ผูก LINE ร้าน — คัดลอกลิงก์ส่งให้แทน'));
  });

  it('copies the public link and shows the expiry date', async () => {
    apiPost.mockResolvedValue({ data: { url: 'https://app.example.com/r/tok', expiresAt: '2026-11-22T00:00:00.000Z' } });
    renderActions({ saleType: 'CASH' });
    fireEvent.click(screen.getByRole('button', { name: 'คัดลอกลิงก์' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/sales/s1/receipt/share'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://app.example.com/r/tok'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('คัดลอกลิงก์แล้ว')));
    expect(vi.mocked(toast.success).mock.calls[0][0]).toContain('22/11/2569');
  });

  it('shows the link in a read-only box when the clipboard is unavailable', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    apiPost.mockResolvedValue({ data: { url: 'https://app.example.com/r/tok', expiresAt: '2026-11-22T00:00:00.000Z' } });
    renderActions({ saleType: 'CASH' });
    fireEvent.click(screen.getByRole('button', { name: 'คัดลอกลิงก์' }));
    const box = await screen.findByDisplayValue('https://app.example.com/r/tok');
    expect(box).toHaveAttribute('readonly');
  });

  it('renders nothing for installment sales and only the print button for voided sales', () => {
    const { container } = renderActions({ saleType: 'INSTALLMENT' });
    expect(container).toBeEmptyDOMElement();

    renderActions({ saleType: 'CASH', deletedAt: '2026-10-23T01:00:00.000Z' });
    expect(screen.getByRole('button', { name: 'พิมพ์ใบเสร็จ' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ส่ง LINE' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'คัดลอกลิงก์' })).toBeNull();
  });
});

describe('helpers', () => {
  it('maps the LINE result to the staff-facing message', () => {
    expect(lineResultMessage({ delivered: true })).toEqual({ kind: 'success', text: 'ส่งใบเสร็จทาง LINE แล้ว' });
    expect(lineResultMessage({ delivered: false, reason: 'NO_LINE_LINK' })).toEqual({ kind: 'error', text: 'ลูกค้ายังไม่ผูก LINE ร้าน — คัดลอกลิงก์ส่งให้แทน' });
    expect(lineResultMessage({ delivered: false, reason: 'PUSH_FAILED' })).toEqual({ kind: 'error', text: 'ส่ง LINE ไม่สำเร็จ ลองใหม่หรือคัดลอกลิงก์' });
  });

  it('builds the pdf path and filename', () => {
    expect(receiptPdfPath('s1')).toBe('/sales/s1/receipt.pdf');
    expect(receiptFilename('SL-1')).toBe('ใบเสร็จ-SL-1.pdf');
  });
});
