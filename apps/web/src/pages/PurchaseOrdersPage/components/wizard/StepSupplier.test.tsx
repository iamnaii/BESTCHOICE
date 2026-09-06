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
      mode="po"
      onModeChange={vi.fn()}
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

describe('StepSupplier — วิธีซื้อ toggle (one wizard, two ways in; owner 2026-09-06)', () => {
  it('PO mode shows the order/expected dates; receive mode books today and hides them', () => {
    const { unmount } = renderStep();
    expect(screen.getByText('วันที่คาดรับสินค้า')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /สั่งซื้อล่วงหน้า/ })).toHaveAttribute('aria-checked', 'true');
    unmount();
    renderStep({ mode: 'receive', form: { ...form, orderDate: '2026-09-06', expectedDate: '' } });
    expect(screen.queryByText('วันที่คาดรับสินค้า')).toBeNull();
    expect(screen.getByText(/รับเข้าวันนี้ 06\/09\/2569/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /ของถึงแล้ว/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('clicking the other way calls onModeChange with a plain button (no submit)', () => {
    const onModeChange = vi.fn();
    renderStep({ onModeChange });
    const receive = screen.getByRole('radio', { name: /ของถึงแล้ว/ });
    expect(receive).toHaveAttribute('type', 'button');
    fireEvent.click(receive);
    expect(onModeChange).toHaveBeenCalledWith('receive');
  });
});
