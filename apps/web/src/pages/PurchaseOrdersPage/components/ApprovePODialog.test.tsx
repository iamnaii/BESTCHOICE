import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApprovePODialog } from './ApprovePODialog';
import type { PurchaseOrder } from '../types';

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const po: PurchaseOrder = {
  id: 'po-1', poNumber: 'PO-2569-09-003', orderDate: '2026-09-10', expectedDate: '2026-09-20',
  orderedAt: null, dueDate: '2026-10-10', status: 'DRAFT', subtotal: '44900', vatAmount: '0',
  totalAmount: '44900', discount: '0', discountAfterVat: '0', netAmount: '44900',
  paymentStatus: 'UNPAID', paymentMethod: null, paidAmount: '0', paymentNotes: null, attachments: [],
  notes: null,
  supplier: { id: 's1', name: 'ขนิษฐา คล้ายมณี', contactName: null, phone: '', hasVat: false },
  createdBy: { id: 'u-bm', name: 'ผจก.สาขาลาดพร้าว' },
  approvedBy: null,
  items: [
    { id: 'i1', brand: 'Apple', model: 'iPhone 17 Pro', color: 'Deep Blue', storage: '256GB', category: 'PHONE_NEW', quantity: 1, unitPrice: '42900', receivedQty: 0, accessoryType: null, accessoryBrand: null },
    { id: 'i2', brand: '', model: 'iPhone 16', color: null, storage: null, category: 'ACCESSORY', quantity: 20, unitPrice: '100', receivedQty: 0, accessoryType: 'ฟิล์ม', accessoryBrand: 'iStar' },
  ],
  _count: { products: 0 },
};
const supplier = {
  id: 's1', name: 'ขนิษฐา คล้ายมณี', contactName: null, hasVat: false,
  paymentMethods: [
    { paymentMethod: 'BANK_TRANSFER', bankName: 'KBank', bankAccountNumber: '123-4-56789-0', creditTermDays: 30, isDefault: true },
  ],
};

type Props = Parameters<typeof ApprovePODialog>[0];
function renderDialog(over: Partial<Props> = {}) {
  const props: Props = {
    open: true, po, supplier, pending: false,
    onClose: vi.fn(), onReject: vi.fn(), onConfirm: vi.fn(),
    ...over,
  };
  render(<ApprovePODialog {...props} />);
  return props;
}

describe('ApprovePODialog — อนุมัติ = สั่งซื้อ + จ่ายเงิน ในกล่องเดียว', () => {
  it('recaps who asked, the supplier, the item count and the net, and defaults to "อนุมัติและสั่งซื้อ" on credit', () => {
    const p = renderDialog();
    expect(screen.getByRole('heading', { name: 'อนุมัติ PO-2569-09-003' })).toBeInTheDocument();
    expect(screen.getByText(/ผจก\.สาขาลาดพร้าว ขอซื้อจาก ขนิษฐา คล้ายมณี/)).toBeInTheDocument();
    expect(screen.getByText(/2 รายการ · 21 ชิ้น/)).toBeInTheDocument();
    expect(screen.getByText(/44,900\.00 บาท/)).toBeInTheDocument();
    // unpaid → tell the owner when the credit falls due
    expect(screen.getByText(/ครบกำหนดชำระ 10\/10\/2569 \(เครดิต 30 วัน\)/)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'อนุมัติและสั่งซื้อ' });
    expect(btn).toHaveAttribute('type', 'button');
    fireEvent.click(btn);
    expect(p.onConfirm).toHaveBeenCalledWith({ id: 'po-1', expectedDate: '2026-09-20' });
  });

  it('recording a deposit changes the button to say what will happen and sends the payment with the approval', () => {
    const p = renderDialog();
    fireEvent.change(screen.getByRole('combobox', { name: 'สถานะการจ่าย' }), { target: { value: 'DEPOSIT_PAID' } });
    fireEvent.click(screen.getByRole('button', { name: '30%' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'บันทึกการจ่าย' }), { target: { value: 'โอน KBank' } });
    fireEvent.click(screen.getByRole('button', { name: 'อนุมัติ · จ่ายมัดจำ 13,470 · สั่งซื้อ' }));
    expect(p.onConfirm).toHaveBeenCalledWith({
      id: 'po-1', expectedDate: '2026-09-20',
      paymentStatus: 'DEPOSIT_PAID', paymentMethod: 'BANK_TRANSFER', paidAmount: 13470, paymentNotes: 'โอน KBank',
    });
  });

  it('blocks a paid amount above the net (same ceiling as the API)', () => {
    renderDialog();
    fireEvent.change(screen.getByRole('combobox', { name: 'สถานะการจ่าย' }), { target: { value: 'PARTIALLY_PAID' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'จำนวนที่จ่าย' }), { target: { value: '50000' } });
    expect(screen.getByRole('button', { name: /^อนุมัติ · จ่ายบางส่วน/ })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('ยอดจ่ายเกินยอดสุทธิ (44,900.00 บาท)');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'จำนวนที่จ่าย' }), { target: { value: '1000' } });
    expect(screen.getByRole('button', { name: 'อนุมัติ · จ่ายบางส่วน 1,000 · สั่งซื้อ' })).toBeEnabled();
  });

  it('blocks an expected date before the order date (the branch manager typed one, the owner cannot approve it as is)', () => {
    renderDialog({ po: { ...po, expectedDate: '2026-09-01' } });
    expect(screen.getByRole('textbox', { name: 'วันที่คาดว่าจะได้รับ' })).toHaveValue('01/09/2569');
    expect(screen.getByRole('alert')).toHaveTextContent('วันที่คาดรับสินค้าต้องไม่ก่อนวันที่สั่ง');
    expect(screen.getByRole('button', { name: 'อนุมัติและสั่งซื้อ' })).toBeDisabled();
  });

  it('"ปฏิเสธ…" hands the PO to the existing reject dialog', () => {
    const p = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'ปฏิเสธ…' }));
    expect(p.onReject).toHaveBeenCalledWith(po);
  });

  it('never renders a submit-type button (real clicks must not submit anything)', () => {
    renderDialog();
    expect(document.querySelector('button[type="submit"]')).toBeNull();
  });
});
