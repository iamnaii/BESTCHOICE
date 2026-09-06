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

describe('usePOForm — catalog-driven item rows', () => {
  beforeEach(() => vi.mocked(toast.error).mockClear());

  const iphone16pro = { brand: 'Apple', name: 'iPhone 16 Pro', category: 'PHONE_NEW' as const, colors: ['Black Titanium'], storage: ['128GB', '256GB'] };
  const ipad = { brand: 'Apple', name: 'iPad (10th gen)', category: 'TABLET' as const, colors: ['Blue'], storage: ['64GB'] };

  it('starts with no item rows (the picker adds them)', () => {
    const { result } = setup();
    expect(result.current.items).toEqual([]);
  });

  it('addCatalogItem appends a row prefilled from the catalog, quantity 1, price empty', () => {
    const { result } = setup();
    act(() => result.current.addCatalogItem(iphone16pro, 'PHONE_USED'));
    expect(result.current.items).toEqual([
      { brand: 'Apple', model: 'iPhone 16 Pro', category: 'PHONE_USED', color: '', storage: '', quantity: '1', unitPrice: '', accessoryType: '', accessoryBrand: '' },
    ]);
  });

  it('addCatalogItem keeps tablets as TABLET regardless of the new/used mode', () => {
    const { result } = setup();
    act(() => result.current.addCatalogItem(ipad, 'PHONE_USED'));
    expect(result.current.items[0]).toMatchObject({ model: 'iPad (10th gen)', category: 'TABLET' });
  });

  it('addAccessoryItem appends an accessory row of the given type', () => {
    const { result } = setup();
    act(() => result.current.addAccessoryItem('เคส'));
    expect(result.current.items[0]).toMatchObject({ category: 'ACCESSORY', accessoryType: 'เคส', brand: 'Apple', model: '', quantity: '1' });
  });

  it('duplicateItem inserts a copy right after the source row', () => {
    const { result } = setup();
    act(() => {
      result.current.addCatalogItem(iphone16pro, 'PHONE_NEW');
      result.current.addCatalogItem(ipad, 'PHONE_NEW');
    });
    act(() => result.current.updateItem(0, 'storage', '256GB'));
    act(() => result.current.duplicateItem(0));
    expect(result.current.items.map((i) => `${i.model}/${i.storage}`)).toEqual([
      'iPhone 16 Pro/256GB', 'iPhone 16 Pro/256GB', 'iPad (10th gen)/',
    ]);
  });

  it('handleCreate blocks with a toast when there are no items', () => {
    const { result, createMutation } = setup();
    act(() => result.current.setForm((f) => ({ ...f, supplierId: 's1' })));
    act(() => result.current.handleCreate(submitEvent));
    expect(createMutation.mutate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ');
  });
});

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
