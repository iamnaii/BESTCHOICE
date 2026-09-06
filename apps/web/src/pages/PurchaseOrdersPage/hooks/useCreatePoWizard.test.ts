import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCreatePoWizard, PURCHASE_STEPS } from './useCreatePoWizard';
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

  it('step 0 gate: a supplierId that resolves to no supplier (stale draft) does not pass', () => {
    const { result } = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts({ selectedSupplier: undefined, form: { ...makeOpts().form, supplierId: 'gone-sup' } }) });
    expect(result.current.canNext).toBe(false);
  });

  it('step 0 gate also needs every item complete (category, quantity>0, unitPrice>0) — items live on step 0 now', () => {
    const { result, rerender } = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts() });
    expect(result.current.canNext).toBe(true);
    rerender(makeOpts({ items: [{ ...baseItem, unitPrice: '' }] }));
    expect(result.current.canNext).toBe(false);
    rerender(makeOpts({ items: [] }));
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

describe('useCreatePoWizard — one wizard, two modes (owner 2026-09-06 "รวมกันได้เลยไหม")', () => {
  beforeEach(() => localStorage.clear());

  it('PO mode: ผู้ขาย + รายการ → สรุป + จ่ายเงิน; receive mode adds ตรวจรับ in between', () => {
    expect(PURCHASE_STEPS.po).toEqual(['ผู้ขาย + รายการ', 'สรุป + จ่ายเงิน']);
    expect(PURCHASE_STEPS.receive).toEqual(['ผู้ขาย + รายการ', 'ตรวจรับ', 'สรุป + จ่ายเงิน']);
  });

  it('starts in PO mode; next() stops at the summary (1); the summary is always advanceable', () => {
    const { result } = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts() });
    expect(result.current.mode).toBe('po');
    expect(result.current.steps).toEqual(PURCHASE_STEPS.po);
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.step).toBe(1);
    expect(result.current.isLast).toBe(true);
    expect(result.current.canNext).toBe(true);
  });

  it('receive mode: three steps, next() stops at 2, step 1 is ตรวจรับ', () => {
    const { result } = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts() });
    act(() => result.current.setMode('receive'));
    expect(result.current.steps).toEqual(PURCHASE_STEPS.receive);
    act(() => result.current.next());
    expect(result.current.isInspect).toBe(true);
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.step).toBe(2);
    expect(result.current.isLast).toBe(true);
  });

  it('the draft remembers the mode; a receive draft reopens on step 0 (units are not saved)', () => {
    const first = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts() });
    act(() => first.result.current.setMode('receive'));
    act(() => first.result.current.next());
    expect(JSON.parse(localStorage.getItem('bestchoice-po-draft') ?? '{}').mode).toBe('receive');
    first.unmount();
    const { result } = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts() });
    expect(result.current.draftRecovered).toBe(true);
    expect(result.current.mode).toBe('receive');
    expect(result.current.step).toBe(0);
  });

  it('a draft saved by the old 3-step wizard (step 2/3, no mode) restores as a PO on the summary (1)', () => {
    localStorage.setItem('bestchoice-po-draft', JSON.stringify({ step: 3, form: makeOpts().form, items: [baseItem], savedAt: new Date().toISOString() }));
    const { result } = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts() });
    expect(result.current.draftRecovered).toBe(true);
    expect(result.current.mode).toBe('po');
    expect(result.current.step).toBe(1);
  });
});

describe('useCreatePoWizard — expectedDate must not be before orderDate', () => {
  beforeEach(() => localStorage.clear());

  it('exposes no error when expectedDate is empty or on/after orderDate', () => {
    const { result, rerender } = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts() });
    expect(result.current.expectedDateError).toBeNull();
    rerender(makeOpts({ form: { ...makeOpts().form, orderDate: '2026-09-13', expectedDate: '2026-09-13' } }));
    expect(result.current.expectedDateError).toBeNull();
  });

  it('exposes the error and blocks step 0 when expectedDate is before orderDate', () => {
    const { result } = renderHook((p) => useCreatePoWizard(p), {
      initialProps: makeOpts({ form: { ...makeOpts().form, orderDate: '2026-09-13', expectedDate: '2026-09-07' } }),
    });
    expect(result.current.step).toBe(0);
    expect(result.current.expectedDateError).toBe('วันที่คาดรับสินค้าต้องไม่ก่อนวันที่สั่ง');
    expect(result.current.canNext).toBe(false);
  });
});
