import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StepSupplier } from './StepSupplier';

vi.mock('@/components/contacts/ContactCombobox', () => ({
  ContactCombobox: () => <div data-testid="contact-combobox" />,
}));

const ERROR = 'วันที่คาดรับสินค้าต้องไม่ก่อนวันที่สั่ง';
const form = {
  supplierId: 's1', orderDate: '2026-09-13', expectedDate: '2026-09-07', notes: '', discount: '',
  discountAfterVat: '', paymentStatus: 'UNPAID', paymentMethod: '', paidAmount: '', paymentNotes: '',
};

function renderStep(overrides: Partial<Parameters<typeof StepSupplier>[0]> = {}) {
  return render(
    <StepSupplier
      form={form}
      setForm={vi.fn()}
      suppliersLoading={false}
      suppliersError={false}
      selectedSupplier={undefined}
      onSupplierSelect={vi.fn()}
      supplierHasVat={false}
      creditTermDays={null}
      dueDatePreview={null}
      inputClass=""
      expectedDateError={null}
      {...overrides}
    />,
  );
}

describe('StepSupplier — expected-date validation message', () => {
  it('shows the error under the expected-date field when given', () => {
    renderStep({ expectedDateError: ERROR });
    expect(screen.getByText(ERROR)).toBeInTheDocument();
  });

  it('shows nothing when there is no error', () => {
    renderStep({ form: { ...form, expectedDate: '2026-09-20' } });
    expect(screen.queryByText(ERROR)).toBeNull();
  });
});

describe('StepSupplier — picking a new order date clears the expected date', () => {
  it('calls setForm with expectedDate reset when a different order date is chosen', () => {
    const setForm = vi.fn();
    const current = { ...form, orderDate: '2026-09-08', expectedDate: '2026-09-09' };
    renderStep({ form: current, setForm });
    // first readonly input = วันที่สั่ง (second = วันที่คาดรับสินค้า)
    fireEvent.click(screen.getAllByPlaceholderText('วว/ดด/ปปปป')[0]);
    fireEvent.click(screen.getByRole('button', { name: '13' }));
    expect(setForm).toHaveBeenCalledWith({ ...current, orderDate: '2026-09-13', expectedDate: '' });
  });
});
