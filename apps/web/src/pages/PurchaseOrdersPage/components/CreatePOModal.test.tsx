import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreatePOModal, type CreatePOModalProps } from './CreatePOModal';
import type { CreatePoWizardApi } from '../hooks/useCreatePoWizard';
import { computePoTotals } from '../poTotals';
import type { ItemForm } from '../types';

const item: ItemForm = {
  brand: 'Apple', category: 'PHONE_NEW', model: 'iPhone 17 Pro', color: '', storage: '256GB',
  quantity: '1', unitPrice: '42900', accessoryType: '', accessoryBrand: '',
};
const form: CreatePOModalProps['form'] = {
  supplierId: 's1', orderDate: '2026-09-06', expectedDate: '', notes: '', discount: '', discountAfterVat: '',
  paymentStatus: 'UNPAID', paymentMethod: '', paidAmount: '', paymentNotes: '',
};
const supplier: CreatePOModalProps['suppliers'][number] = {
  id: 's1', name: 'ขนิษฐา คล้ายมณี', contactName: null, hasVat: false, paymentMethods: [],
};

function renderModal(step: number) {
  const next = vi.fn();
  const wizard: CreatePoWizardApi = {
    step, goToStep: vi.fn(), next, back: vi.fn(), canNext: true, dueDatePreview: null,
    creditTermDays: null, expectedDateError: null, draftRecovered: false, clearDraft: vi.fn(),
  };
  const handleCreate = vi.fn((e: React.FormEvent) => e.preventDefault());
  render(
    <CreatePOModal
      isOpen
      onClose={vi.fn()}
      form={form}
      setForm={vi.fn()}
      items={[item]}
      removeItem={vi.fn()}
      duplicateItem={vi.fn()}
      updateItem={vi.fn()}
      toggleModel={vi.fn()}
      addCatalogItem={vi.fn()}
      addAccessoryItem={vi.fn()}
      addExistingAccessoryItem={vi.fn()}
      searchAccessorySkus={vi.fn().mockResolvedValue([])}
      suppliers={[supplier]}
      suppliersLoading={false}
      suppliersError={false}
      selectedSupplier={supplier}
      onSupplierSelect={vi.fn()}
      supplierHasVat={false}
      subtotal={42900}
      createMutation={{ isPending: false } as unknown as CreatePOModalProps['createMutation']}
      handleCreate={handleCreate}
      attachmentUrl=""
      setAttachmentUrl={vi.fn()}
      formAttachments={[]}
      setFormAttachments={vi.fn()}
      wizard={wizard}
      totals={computePoTotals({ items: [item], discount: '', discountAfterVat: '', supplierHasVat: false })}
    />,
  );
  return { next, handleCreate };
}

// 2026-09-06 bug: "ถัดไป" (type=button) and "สร้าง PO" (type=submit) were the same <button> node.
// A real click on ถัดไป advanced the step, React flushed in a microtask mid-dispatch, the node
// became type=submit, and the browser's activation behaviour submitted the form — the PO was
// created instead of showing the summary. The wizard must therefore never render a submit button.
describe('CreatePOModal footer', () => {
  it('ถัดไป is a plain button that only advances the wizard', () => {
    const { next, handleCreate } = renderModal(1);
    const btn = screen.getByRole('button', { name: 'ถัดไป' });
    expect(btn).toHaveAttribute('type', 'button');
    fireEvent.click(btn);
    expect(next).toHaveBeenCalledTimes(1);
    expect(handleCreate).not.toHaveBeenCalled();
  });

  it('สร้าง PO on the last step is a plain button whose click runs handleCreate', () => {
    const { handleCreate } = renderModal(2);
    const btn = screen.getByRole('button', { name: 'สร้าง PO' });
    expect(btn).toHaveAttribute('type', 'button');
    expect(document.querySelector('button[type="submit"]')).toBeNull();
    fireEvent.click(btn);
    expect(handleCreate).toHaveBeenCalledTimes(1);
  });
});
