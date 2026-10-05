import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { StepSummary } from './StepSummary';
import { computePoTotals } from '../../poTotals';
import type { ItemForm } from '../../types';

const item: ItemForm = {
  brand: 'Apple', category: 'PHONE_NEW', model: 'iPhone 16 Pro', color: 'Black Titanium', storage: '256GB',
  quantity: '2', unitPrice: '42900', accessoryType: '', accessoryBrand: '',
};
const baseForm = {
  supplierId: 's1', orderDate: '2026-09-13', expectedDate: '2026-09-20', notes: '', discount: '',
  discountAfterVat: '', paymentStatus: 'UNPAID', paymentMethod: '', paidAmount: '', paymentNotes: '',
};
const supplier = {
  id: 's1', name: 'ขนิษฐา คล้ายมณี', contactName: null, hasVat: false,
  paymentMethods: [{ paymentMethod: 'BANK_TRANSFER', bankName: 'KBank', bankAccountNumber: '123-4-56789-0', isDefault: true }],
};

function renderStep(overrides: Partial<Parameters<typeof StepSummary>[0]> = {}) {
  const form = { ...baseForm, ...(overrides.form ?? {}) };
  const props = {
    form,
    setForm: vi.fn(),
    items: [item],
    selectedSupplier: supplier,
    supplierHasVat: false,
    totals: computePoTotals({ items: [item], discount: form.discount, discountAfterVat: form.discountAfterVat, supplierHasVat: false }),
    dueDatePreview: null,
    attachmentUrl: '',
    setAttachmentUrl: vi.fn(),
    formAttachments: [] as string[],
    setFormAttachments: vi.fn(),
    onEditItems: vi.fn(),
    ...overrides,
    ...(overrides.form ? { form } : {}),
  };
  render(<StepSummary {...props} />);
  return props;
}

describe('StepSummary — สรุป + จ่ายเงิน (last step of the 3-step wizard)', () => {
  it('recaps supplier, dates and item count with a shortcut back to the items step', () => {
    const p = renderStep();
    const recap = screen.getByRole('region', { name: 'สรุปใบสั่งซื้อ' });
    expect(recap).toHaveTextContent('ขนิษฐา คล้ายมณี');
    expect(recap).toHaveTextContent('13/09/2569');
    expect(recap).toHaveTextContent('20/09/2569');
    expect(recap).toHaveTextContent('1 รายการ · 2 ชิ้น');
    fireEvent.click(within(recap).getByRole('button', { name: 'แก้ไขรายการ' }));
    expect(p.onEditItems).toHaveBeenCalled();
  });

  it('totals table: subtotal, inline discount input, net', () => {
    const p = renderStep();
    expect(screen.getByText('85,800.00 บาท', { selector: '[data-testid="subtotal"]' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'ส่วนลด' }), { target: { value: '800' } });
    expect(p.setForm).toHaveBeenCalledWith(expect.objectContaining({ discount: '800' }));
    expect(screen.getByTestId('net-amount')).toHaveTextContent('85,800.00 บาท');
  });

  it('hides the after-VAT discount for suppliers without VAT', () => {
    renderStep();
    expect(screen.queryByRole('spinbutton', { name: 'ส่วนลด (หลัง VAT)' })).toBeNull();
    expect(screen.getByText('ผู้จัดจำหน่ายไม่มี VAT')).toBeInTheDocument();
  });

  // ก้อน 2 (2026-10-05): ใบสั่งซื้อปกติไม่มีช่องจ่ายเงินแล้ว (จ่ายหลังอนุมัติผ่านปุ่มบันทึกการจ่าย) —
  // ส่วน "รับเข้าตรง" ยังจ่ายทันทีได้ แต่โอนธนาคารเท่านั้น + สลิปบังคับ
  it('โหมดใบสั่งซื้อ: ไม่มีช่องจ่ายเงิน แต่บอกว่าไปบันทึกหลังอนุมัติ', () => {
    renderStep();
    expect(screen.queryByRole('combobox', { name: 'สถานะการจ่าย' })).toBeNull();
    expect(screen.getByText(/บันทึกการจ่ายหลังอนุมัติ/)).toBeInTheDocument();
  });

  it('โหมดรับเข้าตรง: มีช่องจ่ายเงิน เลือกจ่ายครบแล้วเติมยอดสุทธิ วิธีจ่ายไม่มีเงินสด และบอกว่าต้องแนบสลิป', () => {
    const p = renderStep({ receive: { passed: 2, rejected: 0 }, form: { ...baseForm, paymentStatus: 'FULLY_PAID', paymentMethod: 'BANK_TRANSFER', paidAmount: '85800' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'สถานะการจ่าย' }), { target: { value: 'FULLY_PAID' } });
    expect(p.setForm).toHaveBeenCalledWith(expect.objectContaining({ paymentStatus: 'FULLY_PAID', paidAmount: '85800' }));
    const method = screen.getByRole('combobox', { name: 'วิธีจ่ายเงิน' }) as HTMLSelectElement;
    expect(Array.from(method.options).map((o) => o.textContent)).not.toContain('เงินสด');
    expect(screen.getByText(/โอนธนาคารเท่านั้น/)).toBeInTheDocument();
    expect(screen.getByText(/ต้องแนบสลิป/)).toBeInTheDocument();
  });

  it('notes textarea updates the form', () => {
    const p = renderStep();
    fireEvent.change(screen.getByRole('textbox', { name: 'หมายเหตุ' }), { target: { value: 'ส่งสาขาลาดพร้าว' } });
    expect(p.setForm).toHaveBeenCalledWith(expect.objectContaining({ notes: 'ส่งสาขาลาดพร้าว' }));
  });
});

describe('StepSummary — recovered draft whose supplier no longer exists', () => {
  it('names the problem instead of showing "-" (QA 2026-09-06)', () => {
    renderStep({ selectedSupplier: undefined });
    expect(screen.getByRole('alert')).toHaveTextContent('ไม่พบผู้จัดจำหน่ายที่บันทึกไว้ในร่าง — กลับไปเลือกใหม่ที่ขั้น "เลือกผู้ขาย"');
  });
});
