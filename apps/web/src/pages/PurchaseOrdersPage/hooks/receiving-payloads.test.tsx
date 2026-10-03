import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { emptyAnglePhotos } from '@/constants/photo-angles';
import type { ReceivingUnitForm } from '../types';
import { usePurchaseOrdersData } from './usePurchaseOrdersData';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  getErrorMessage: () => 'error',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  vi.mocked(api.post).mockResolvedValue({ data: { received: 1, rejected: 0 } });
});
function unit(over: Partial<ReceivingUnitForm>): ReceivingUnitForm {
  return {
    poItemId: 'po-item',
    label: 'เครื่องทดสอบ',
    category: 'PHONE_USED',
    imeiSerial: 'TEST-IMEI',
    serialNumber: 'TEST-SERIAL',
    status: 'PASS',
    rejectReason: 'จอแตก',
    defectReason: 'SCREEN',
    batteryHealth: '88',
    warrantyExpired: false,
    warrantyExpireDate: '2027-01-01',
    hasBox: true,
    checklist: [
      { item: 'จอ', category: 'ภายนอก', passed: true, note: '' },
      { item: 'กล้อง', category: 'ระบบ', passed: false, note: 'มีรอย' },
    ],
    sellingPrice: '12345.67',
    installmentPrice: '13500.25',
    costPrice: '10000.15',
    photos: ['photo'],
    anglePhotos: { ...emptyAnglePhotos(), front: 'front-photo' },
    deviceOrigin: 'TH',
    shopWarrantyDays: '30',
    warrantyTerms: ' เงื่อนไขทดสอบ ',
    brand: 'Apple',
    model: 'iPhone',
    color: 'ดำ',
    storage: '128GB',
    ...over,
  };
}
async function sendBoth(item: ReceivingUnitForm) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => usePurchaseOrdersData(), { wrapper });
  await act(async () => {
    await result.current.goodsReceivingMutation.mutateAsync({
      poId: 'po-1',
      items: [item],
      notes: '',
    });
    await result.current.directReceiveMutation.mutateAsync({
      supplierId: 'supplier',
      orderDate: '2026-10-03',
      items: [item],
      paidAmount: 10000.15,
      discount: 0.01,
    });
  });
  const calls = vi.mocked(api.post).mock.calls;
  expect(calls[0][0]).toBe('/purchase-orders/po-1/goods-receiving');
  expect(calls[1][0]).toBe('/purchase-orders/direct-receive');
  const po = calls[0][1] as { items: Record<string, unknown>[]; notes?: string };
  const direct = calls[1][1] as {
    items: Record<string, unknown>[];
    paidAmount: number;
    discount: number;
  };
  expect(po.notes).toBeUndefined();
  expect(direct.paidAmount).toBe(10000.15);
  expect(direct.discount).toBe(0.01);
  return { po: po.items[0], direct: direct.items[0] };
}

it.each([
  ['PHONE_USED', 'PASS'],
  ['PHONE_USED', 'REJECT'],
  ['PHONE_NEW', 'PASS'],
  ['PHONE_NEW', 'REJECT'],
  ['ACCESSORY', 'PASS'],
  ['ACCESSORY', 'REJECT'],
] as const)(
  '%s %s retains shared inspection fields and distinct flow identifiers/prices',
  async (category, status) => {
    const { po, direct } = await sendBoth(unit({ category, status }));
    const common = {
      deviceOrigin: 'TH',
      shopWarrantyDays: 30,
      warrantyTerms: 'เงื่อนไขทดสอบ',
      imeiSerial: 'TEST-IMEI',
      serialNumber: 'TEST-SERIAL',
      status,
      rejectReason: status === 'REJECT' ? 'จอแตก' : undefined,
      defectReason: status === 'REJECT' ? 'SCREEN' : undefined,
      photos: ['photo'],
      ...(category === 'PHONE_USED' && status === 'PASS'
        ? {
            anglePhotos: { front: 'front-photo' },
            batteryHealth: 88,
            warrantyExpired: false,
            warrantyExpireDate: '2027-01-01',
            hasBox: true,
            checklistResults: [
              { item: 'จอ', category: 'ภายนอก', passed: true },
              { item: 'กล้อง', category: 'ระบบ', passed: false, note: 'มีรอย' },
            ],
          }
        : {}),
      ...(status === 'PASS' ? { sellingPrice: 12345.67, installmentPrice: 13500.25 } : {}),
    };
    expect(po).toEqual({ poItemId: 'po-item', ...common });
    expect(direct).toEqual({
      ...common,
      category,
      brand: 'Apple',
      model: 'iPhone',
      color: 'ดำ',
      storage: '128GB',
      accessoryType: undefined,
      accessoryBrand: undefined,
      quantity: 1,
      unitPrice: 10000.15,
    });
  },
);

it('preserves empty-field omission, nullable warranty fields and zero strings', async () => {
  const { po, direct } = await sendBoth(
    unit({
      imeiSerial: '',
      serialNumber: '',
      deviceOrigin: '',
      shopWarrantyDays: '',
      warrantyTerms: ' ',
      photos: [],
      anglePhotos: emptyAnglePhotos(),
      batteryHealth: '0',
      sellingPrice: '0',
      installmentPrice: '',
      warrantyExpired: true,
    }),
  );
  for (const payload of [po, direct]) {
    expect(payload).toMatchObject({
      deviceOrigin: null,
      shopWarrantyDays: null,
      warrantyTerms: null,
      batteryHealth: 0,
      sellingPrice: 0,
      warrantyExpired: true,
    });
    for (const key of [
      'imeiSerial',
      'serialNumber',
      'photos',
      'anglePhotos',
      'warrantyExpireDate',
      'installmentPrice',
    ])
      expect(payload[key]).toBeUndefined();
  }
});
