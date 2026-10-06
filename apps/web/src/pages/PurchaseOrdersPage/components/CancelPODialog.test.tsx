import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CancelPODialog } from './CancelPODialog';
import type { PurchaseOrder, SupplierPaymentSummary } from '../types';

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const po: PurchaseOrder = {
  id: 'po-40', poNumber: 'PO-2569-10-040', orderDate: '2026-09-20', expectedDate: null, orderedAt: null, dueDate: null,
  status: 'ORDERED', subtotal: '8000', vatAmount: '0', totalAmount: '8000', discount: '0', discountAfterVat: '0', netAmount: '8000',
  paymentStatus: 'DEPOSIT_PAID', paymentMethod: 'BANK_TRANSFER', paidAmount: '3000', paymentNotes: null, attachments: [], notes: null,
  supplier: { id: 's2', name: 'ร้านไอโฟนมือสอง สุขุมวิท', contactName: null, phone: '', hasVat: false },
  createdBy: { id: 'u1', name: 'เจ้าของ' }, approvedBy: null, items: [{ id: 'i1', brand: 'Apple', model: 'iPhone 13', color: null, storage: '128GB', category: 'PHONE_USED', quantity: 1, unitPrice: '8000', receivedQty: 0, accessoryType: null, accessoryBrand: null }],
  _count: { products: 0 },
};
const withDeposit: SupplierPaymentSummary = {
  netAmount: '8000.00', paidTotal: '3000.00', remainingOnPo: '5000.00', payableOutstanding: '0.00', payableByAccount: {},
  depositOutstanding: '3000.00', hasBookedPayable: false, status: 'DEPOSIT_PAID',
};
const noDeposit: SupplierPaymentSummary = { ...withDeposit, paidTotal: '0.00', remainingOnPo: '8000.00', depositOutstanding: '0.00', status: 'UNPAID' };

type Props = Parameters<typeof CancelPODialog>[0];
function renderDialog(over: Partial<Props> = {}) {
  const props: Props = { open: true, po, summary: withDeposit, summaryLoading: false, pending: false, onClose: vi.fn(), onConfirm: vi.fn(), ...over };
  render(<CancelPODialog {...props} />);
  return props;
}

describe('CancelPODialog — ยกเลิกใบสั่งซื้อที่มัดจำแล้ว (กระดาน 4)', () => {
  it('มีมัดจำค้าง → ต้องเลือกได้คืน/ไม่ได้คืน · ได้คืนครบ: หลักฐานบังคับ แล้วส่ง payload REFUNDED', () => {
    const p = renderDialog();
    expect(screen.getByRole('heading', { name: 'ยกเลิกใบสั่งซื้อ PO-2569-10-040' })).toBeInTheDocument();
    expect(screen.getByText(/จ่ายมัดจำไปแล้ว/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'ยืนยันยกเลิกใบสั่งซื้อ' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'ได้เงินมัดจำคืน' }));
    expect((screen.getByRole('spinbutton', { name: 'จำนวนที่ได้คืน (บาท)' }) as HTMLInputElement).value).toBe('3000');
    expect(screen.getAllByText(/S11-1201/).length).toBeGreaterThan(0);
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'ลิงก์หลักฐานการโอนคืน' }), { target: { value: 'https://x/refund.jpg' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(p.onConfirm).toHaveBeenCalledWith({ depositOutcome: 'REFUNDED', refundedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), refundAmount: 3000, slipUrl: 'https://x/refund.jpg', reason: undefined });
  });

  it('ได้คืนไม่ครบ → พรีวิวมีบรรทัด S53-1105 ส่วนขาด · เกินมัดจำค้าง → ปิดปุ่ม', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'ได้เงินมัดจำคืน' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'ลิงก์หลักฐานการโอนคืน' }), { target: { value: 'https://x/refund.jpg' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'จำนวนที่ได้คืน (บาท)' }), { target: { value: '2000' } });
    expect(screen.getByText('ค่าใช้จ่าย - มัดจำที่ไม่ได้คืน')).toBeInTheDocument();
    expect(screen.getByText('1,000.00')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'จำนวนที่ได้คืน (บาท)' }), { target: { value: '5000' } });
    expect(screen.getByText(/ไม่เกินมัดจำค้าง 3,000\.00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ยืนยันยกเลิกใบสั่งซื้อ' })).toBeDisabled();
  });

  it('ไม่ได้คืน → เหตุผลบังคับ แล้วส่ง FORFEITED', () => {
    const p = renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'ไม่ได้เงินมัดจำคืน' }));
    const confirm = screen.getByRole('button', { name: 'ยืนยันยกเลิกใบสั่งซื้อ' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /เหตุผล/ }), { target: { value: 'ผู้จัดจำหน่ายริบมัดจำ' } });
    expect(screen.getAllByText('3,000.00', { selector: 'td' }).length).toBe(2);
    fireEvent.click(confirm);
    expect(p.onConfirm).toHaveBeenCalledWith({ depositOutcome: 'FORFEITED', reason: 'ผู้จัดจำหน่ายริบมัดจำ' });
  });

  it('ไม่มีมัดจำ → ยืนยันธรรมดา ส่ง undefined', () => {
    const p = renderDialog({ summary: noDeposit, po: { ...po, paymentStatus: 'UNPAID', paidAmount: '0' } });
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText(/สั่งซื้อแล้วแต่ยังไม่ได้รับของ/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันยกเลิกใบสั่งซื้อ' }));
    expect(p.onConfirm).toHaveBeenCalledWith(undefined);
  });
});
