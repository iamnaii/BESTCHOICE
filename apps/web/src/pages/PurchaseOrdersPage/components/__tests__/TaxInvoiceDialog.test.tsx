import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import TaxInvoiceDialog from '../TaxInvoiceDialog';

/** ก้อน 5 — dialog ใบกำกับที่มาทีหลัง: เลขที่+วันที่บังคับ รูปไม่บังคับ · ส่ง multipart · เตือนเลขซ้ำไม่บล็อก · โชว์ผลเคลมย้อน */
const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
  getErrorMessage: (e: unknown) => (e as Error)?.message ?? 'unknown',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const po = { id: 'po-1', poNumber: 'PO-1', supplier: { id: 's1', name: 'ร้าน A', contactName: null, phone: '', hasVat: true } } as never;
const receiving = { id: 'gr-1', grNumber: 'GR-1', createdAt: '2026-10-05T03:00:00Z', notes: null, supplierDocType: 'DELIVERY_NOTE', supplierDocNumber: 'DN-1', supplierDocDate: '2026-10-04T17:00:00Z', receivedBy: { id: 'u', name: 'ก' }, items: [], taxInvoice: null } as never;

function renderDialog(onRecorded = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><TaxInvoiceDialog open onClose={() => {}} po={po} receiving={receiving} onRecorded={onRecorded} /></QueryClientProvider>);
  return { onRecorded };
}

beforeEach(() => { vi.clearAllMocks(); apiGet.mockResolvedValue({ data: { duplicates: [], periodClosed: false } }); });

describe('TaxInvoiceDialog', () => {
  it('ปุ่มบันทึกปิดจนกว่ากรอกเลขที่และวันที่ · ส่ง FormData ไป endpoint ใบรับของ · เรียก onRecorded ด้วยผล', async () => {
    const user = userEvent.setup();
    const result = { receiving: { id: 'gr-1', grNumber: 'GR-1', taxInvoice: { number: 'IV-10', date: '2026-10-04', source: 'LATER' } }, claimed: [{ contractId: 'c', contractNumber: 'CT-1', journalEntryNo: 'JE-1', amount: '686.00', postedOnInvoiceDate: false }], accountingNotified: false };
    apiPost.mockResolvedValue({ data: result });
    const { onRecorded } = renderDialog();
    const submit = screen.getByRole('button', { name: 'บันทึกใบกำกับภาษี' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('เลขที่ใบกำกับภาษี'), 'IV-10');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('วันที่ในใบกำกับ'), '2026-10-04');
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [url, body] = apiPost.mock.calls[0];
    expect(url).toBe('/purchase-orders/po-1/goods-receivings/gr-1/tax-invoice');
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('number')).toBe('IV-10');
    expect((body as FormData).get('date')).toBe('2026-10-04');
    await waitFor(() => expect(onRecorded).toHaveBeenCalledWith(result));
    expect(await screen.findByText(/เคลมภาษีซื้อย้อนให้ 1 สัญญา \(CT-1\)/)).toBeInTheDocument();
  });

  it('เลขที่ซ้ำของผู้จัดจำหน่ายเดิม → เตือน (ไม่ปิดปุ่ม)', async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValue({ data: { duplicates: [{ grNumber: 'GR-0', poNumber: 'PO-0', receivedAt: '2026-10-01T00:00:00Z' }], periodClosed: false } });
    renderDialog();
    await user.type(screen.getByLabelText('เลขที่ใบกำกับภาษี'), 'IV-10');
    await user.type(screen.getByLabelText('วันที่ในใบกำกับ'), '2026-10-04');
    expect(await screen.findByText(/เลขที่นี้เคยใช้กับใบรับของ GR-0/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'บันทึกใบกำกับภาษี' })).toBeEnabled();
  });

  it('วันที่อนาคต → ข้อความเดียวกับ API และปุ่มปิด', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText('เลขที่ใบกำกับภาษี'), 'IV-10');
    await user.type(screen.getByLabelText('วันที่ในใบกำกับ'), '2999-01-01');
    expect(screen.getByText(/วันที่ในเอกสารต้องไม่เกินวันนี้/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'บันทึกใบกำกับภาษี' })).toBeDisabled();
  });
});
