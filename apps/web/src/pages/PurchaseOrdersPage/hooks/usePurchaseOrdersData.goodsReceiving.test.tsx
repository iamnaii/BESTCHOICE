import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '@/lib/api';
import { usePurchaseOrdersData } from './usePurchaseOrdersData';
import type { ReceivingUnitForm } from '../types';
import { emptyAnglePhotos } from '@/constants/photo-angles';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

/** ข3 — ช่องเอกสารจากผู้จัดจำหน่ายต้องถูกส่งไปกับคำขอรับสินค้าตามใบสั่งซื้อจริง (ไม่ใช่แค่โชว์บนจอ) */
const unit: ReceivingUnitForm = {
  poItemId: 'line-1', label: 'เคส #1', category: 'ACCESSORY', imeiSerial: '', serialNumber: '',
  status: 'PASS', rejectReason: '', defectReason: '', batteryHealth: '', warrantyExpired: false,
  warrantyExpireDate: '', hasBox: true, checklist: [], sellingPrice: '', installmentPrice: '',
  photos: [], anglePhotos: emptyAnglePhotos(), costPrice: '150',
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('usePurchaseOrdersData — goodsReceivingMutation ส่งช่องเอกสาร (ข3)', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    vi.mocked(api.post).mockReset();
    vi.mocked(api.post).mockResolvedValue({ data: { products: [], passed: 1, rejected: 0 } });
  });

  it('มีเอกสาร: ส่งประเภท + เลขที่ (ตัดช่องว่าง) + วันที่', async () => {
    const { result } = renderHook(() => usePurchaseOrdersData(), { wrapper });
    await result.current.goodsReceivingMutation.mutateAsync({
      poId: 'po-1',
      items: [unit],
      notes: '',
      supplierDoc: { type: 'TAX_INVOICE', number: '  IV2609-0877 ', date: '2026-09-28' },
    });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/purchase-orders/po-1/goods-receiving');
    expect(body).toMatchObject({
      supplierDocType: 'TAX_INVOICE',
      supplierDocNumber: 'IV2609-0877',
      supplierDocDate: '2026-09-28',
    });
  });

  it('ไม่มีเอกสาร: ส่งแค่ประเภท + หมายเหตุ (ไม่ส่งเลขที่/วันที่ที่ค้างในฟอร์ม)', async () => {
    const { result } = renderHook(() => usePurchaseOrdersData(), { wrapper });
    await result.current.goodsReceivingMutation.mutateAsync({
      poId: 'po-1',
      items: [unit],
      notes: 'ร้านไม่ออกบิล',
      supplierDoc: { type: 'NONE', number: 'IV-เก่า', date: '2026-09-01' },
    });
    const body = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>;
    expect(body.supplierDocType).toBe('NONE');
    expect(body.notes).toBe('ร้านไม่ออกบิล');
    expect(body).not.toHaveProperty('supplierDocNumber');
    expect(body).not.toHaveProperty('supplierDocDate');
  });
});
