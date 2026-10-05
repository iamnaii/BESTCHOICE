import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import RequestAdjustmentDialog from '../components/RequestAdjustmentDialog';

/**
 * ก้อน 3 — ฟอร์มคำขอตัดสินค้า: ไม่มีช่องผู้อนุมัติอีกแล้ว (เจ้าของอนุมัติทุกใบ) · เหตุผล "เสียหาย" บังคับรูป ·
 * ส่งเป็น multipart (FormData) ไม่ใช่ JSON/data URI
 */
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
  getErrorMessage: (err: unknown) =>
    err && typeof err === 'object' && 'message' in err ? String((err as Error).message) : 'unknown',
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'sales-1', role: 'SALES', branchId: 'b1' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

const PRODUCT = {
  id: 'p1',
  name: 'iPhone 15 128GB',
  brand: 'Apple',
  model: 'iPhone 15',
  imeiSerial: '350000000000001',
  serialNumber: null,
  status: 'IN_STOCK',
  deletedAt: null,
  branch: { id: 'b1', name: 'ลาดพร้าว' },
  costPrice: '12000.00',
  category: 'PHONE_NEW',
  pendingRequestNumber: null,
};

const PREVIEW = {
  productStatusAfter: 'LOST',
  holdsProduct: true,
  costAmount: '12000.00',
  inventoryAccountCode: 'S11-2001',
  booked: { booked: true, source: 'GOODS_RECEIVING', bookedAmount: '12000.00', journalEntryNo: 'JE-202610-00012', grNumber: 'GR-1' },
  journalLines: [
    { accountCode: 'S53-1102', name: 'ขาดทุนสินค้าเสียหาย/สูญหายสาขา', debit: '12000.00', credit: '0.00' },
    { accountCode: 'S11-2001', name: 'สินค้าคงคลัง - มือถือใหม่', debit: '0.00', credit: '12000.00' },
  ],
  journalNote: 'ลงบัญชีเมื่ออนุมัติ',
  requiresPhoto: false,
};

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiGet.mockImplementation(async (url: string) => {
    if (url === '/stock-adjustments/lookup') return { data: [PRODUCT] };
    if (url === '/stock-adjustments/preview') return { data: PREVIEW };
    return { data: [] };
  });
  apiPost.mockResolvedValue({ data: { id: 'adj-1', requestNumber: 'SA-20261005-0001' } });
});

async function pickProduct(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText(/IMEI/), '3500');
  const hit = await screen.findByRole('button', { name: /iPhone 15/ }, { timeout: 3000 });
  await user.click(hit);
}

describe('RequestAdjustmentDialog', () => {
  it('ไม่มีช่องผู้อนุมัติ', () => {
    render(wrap(<RequestAdjustmentDialog open onClose={() => {}} />));
    expect(screen.queryByLabelText(/ผู้อนุมัติ/)).toBeNull();
    expect(screen.getByText(/เจ้าของ/)).toBeInTheDocument();
  });

  it('เลือก "เสียหาย" โดยไม่มีรูป → ปุ่มส่งปิด + บอกว่าต้องแนบรูป', async () => {
    const user = userEvent.setup();
    render(wrap(<RequestAdjustmentDialog open onClose={() => {}} />));
    await pickProduct(user);
    await user.click(screen.getByRole('radio', { name: /เสียหาย/ }));
    expect(screen.getByRole('button', { name: /ส่งคำขอ/ })).toBeDisabled();
    expect(screen.getAllByText(/ต้องแนบรูป/).length).toBeGreaterThan(0);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('เลือกเครื่อง + "สูญหาย" → เห็น preview บัญชี · ส่งเป็น FormData ไปที่ POST /stock-adjustments', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(wrap(<RequestAdjustmentDialog open onClose={() => {}} onCreated={onCreated} />));
    await pickProduct(user);
    await user.click(screen.getByRole('radio', { name: /สูญหาย/ }));
    await screen.findByText('S53-1102', {}, { timeout: 3000 });
    expect(screen.getByText(/จะถูกพักขายทันที/)).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: /ส่งคำขอ/ });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [url, body] = apiPost.mock.calls[0];
    expect(url).toBe('/stock-adjustments');
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('productId')).toBe('p1');
    expect((body as FormData).get('reason')).toBe('LOST');
    expect((body as FormData).has('approverId')).toBe(false);
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });
});
