import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCreatePoWizard } from './useCreatePoWizard';
import type { ItemForm } from '../types';

const baseItem: ItemForm = { brand: 'Apple', category: 'PHONE_NEW', model: 'iPhone 16', color: '', storage: '', quantity: '2', unitPrice: '30000', accessoryType: '', accessoryBrand: '' };

function makeOpts(overrides: Partial<Parameters<typeof useCreatePoWizard>[0]> = {}) {
  const form = {
    supplierId: 's1', orderDate: '2026-07-01', expectedDate: '', discount: '', discountAfterVat: '',
    notes: '', paymentStatus: 'UNPAID', paymentMethod: '', paidAmount: '', paymentNotes: '',
  };
  return {
    isOpen: true,
    form,
    setForm: vi.fn(),
    items: [baseItem],
    setItems: vi.fn(),
    selectedSupplier: { id: 's1', name: 'ผู้ขาย ก', hasVat: true, paymentMethods: [{ paymentMethod: 'CREDIT', creditTermDays: 30, isDefault: true }] },
    ...overrides,
  } as Parameters<typeof useCreatePoWizard>[0];
}

describe('useCreatePoWizard', () => {
  beforeEach(() => localStorage.clear());

  it('step 0 (supplier) gate: requires a supplierId', () => {
    const { result, rerender } = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts({ selectedSupplier: undefined, form: { ...makeOpts().form, supplierId: '' } }) });
    expect(result.current.step).toBe(0);
    expect(result.current.canNext).toBe(false);
    rerender(makeOpts()); // now supplier selected
    expect(result.current.canNext).toBe(true);
  });

  it('step 1 (items) gate: every item needs category, quantity>0, unitPrice>0', () => {
    const { result, rerender } = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts() });
    act(() => result.current.next()); // -> step 1
    expect(result.current.step).toBe(1);
    expect(result.current.canNext).toBe(true);
    rerender(makeOpts({ items: [{ ...baseItem, unitPrice: '' }] }));
    expect(result.current.canNext).toBe(false);
  });

  it('computes dueDatePreview = orderDate + default creditTermDays', () => {
    const { result } = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts() });
    expect(result.current.creditTermDays).toBe(30);
    // 2026-07-01 + 30 days = 2026-07-31
    expect(result.current.dueDatePreview?.toISOString().slice(0, 10)).toBe('2026-07-31');
  });

  it('dueDatePreview follows the selected paymentMethod credit term', () => {
    const opts = makeOpts({
      form: { ...makeOpts().form, paymentMethod: 'CASH' },
      selectedSupplier: { id: 's1', name: 'ก', hasVat: true, paymentMethods: [
        { paymentMethod: 'CASH', creditTermDays: 0, isDefault: false },
        { paymentMethod: 'CREDIT', creditTermDays: 45, isDefault: true },
      ] },
    });
    const { result } = renderHook((p) => useCreatePoWizard(p), { initialProps: opts });
    expect(result.current.creditTermDays).toBe(0); // CASH selected -> no credit term
    expect(result.current.dueDatePreview).toBeNull();
  });

  it('saves a draft to localStorage and recovers it on a fresh mount', () => {
    const setForm = vi.fn();
    const setItems = vi.fn();
    const { unmount } = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts() });
    // force an immediate save (the hook saves on form/items/step change, debounced via effect)
    expect(localStorage.getItem('bestchoice-po-draft')).not.toBeNull();
    unmount();
    const { result } = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts({ setForm, setItems }) });
    expect(result.current.draftRecovered).toBe(true);
    expect(setForm).toHaveBeenCalled();
    expect(setItems).toHaveBeenCalled();
  });
});
