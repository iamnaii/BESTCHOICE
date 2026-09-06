import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { FormEvent } from 'react';
import { usePOForm } from './usePOForm';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from 'sonner';

const supplier = { id: 's1', name: 'ผู้ขาย ก', contactName: null, hasVat: false, paymentMethods: [] };
const item = {
  brand: 'Apple', category: 'PHONE_NEW', model: 'iPhone 16', color: '', storage: '',
  quantity: '1', unitPrice: '100', accessoryType: '', accessoryBrand: '',
};
const submitEvent = { preventDefault: () => {} } as unknown as FormEvent;

function setup() {
  const createMutation = { mutate: vi.fn() } as unknown as Parameters<typeof usePOForm>[0]['createMutation'];
  const hook = renderHook(() => usePOForm({ createMutation, suppliers: [supplier] }));
  return { ...hook, createMutation };
}

describe('usePOForm.handleCreate — expectedDate must not be before orderDate', () => {
  beforeEach(() => vi.mocked(toast.error).mockClear());

  it('blocks submit with a toast when expectedDate is before orderDate', () => {
    const { result, createMutation } = setup();
    act(() => {
      result.current.setForm((f) => ({ ...f, supplierId: 's1', orderDate: '2026-09-13', expectedDate: '2026-09-07' }));
      result.current.setItems([item]);
    });
    act(() => result.current.handleCreate(submitEvent));
    expect(createMutation.mutate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('วันที่คาดรับสินค้าต้องไม่ก่อนวันที่สั่ง');
  });

  it('submits when expectedDate is on/after orderDate', () => {
    const { result, createMutation } = setup();
    act(() => {
      result.current.setForm((f) => ({ ...f, supplierId: 's1', orderDate: '2026-09-13', expectedDate: '2026-09-13' }));
      result.current.setItems([item]);
    });
    act(() => result.current.handleCreate(submitEvent));
    expect(toast.error).not.toHaveBeenCalled();
    expect(createMutation.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ orderDate: '2026-09-13', expectedDate: '2026-09-13' }),
    );
  });
});
