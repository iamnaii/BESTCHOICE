import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClosePOShortDialog } from './ClosePOShortDialog';
import type { PurchaseOrder, SupplierPaymentSummary } from '../types';

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const po: PurchaseOrder = {
  id: 'po-41', poNumber: 'PO-2569-10-041', orderDate: '2026-09-20', expectedDate: null, orderedAt: null, dueDate: null,
  status: 'PARTIALLY_RECEIVED', subtotal: '15000', vatAmount: '0', totalAmount: '15000', discount: '0', discountAfterVat: '0', netAmount: '15000',
  paymentStatus: 'UNPAID', paymentMethod: 'BANK_TRANSFER', paidAmount: '0', paymentNotes: null, attachments: [], notes: null,
  supplier: { id: 's2', name: 'ร้านไอโฟนมือสอง สุขุมวิท', contactName: null, phone: '', hasVat: false },
  createdBy: { id: 'u1', name: 'เจ้าของ' }, approvedBy: null,
  items: [
    { id: 'i1', brand: 'Apple', model: 'iPhone 13', color: null, storage: '128GB', category: 'PHONE_USED', quantity: 5, unitPrice: '2800', receivedQty: 2, accessoryType: null, accessoryBrand: null },
    { id: 'i2', brand: 'Spigen', model: 'iPhone 13', color: null, storage: null, category: 'ACCESSORY', quantity: 1, unitPrice: '1000', receivedQty: 1, accessoryType: 'เคส', accessoryBrand: 'Spigen' },
  ],
  _count: { products: 2 },
};
const noDeposit: SupplierPaymentSummary = {
  netAmount: '15000.00', paymentCap: '6000.00', paidTotal: '0.00', remainingOnPo: '6000.00', payableOutstanding: '6000.00',
  payableByAccount: { 'S21-1101': '6000.00' }, depositOutstanding: '0.00', hasBookedPayable: true, status: 'UNPAID',
};
const withDeposit: SupplierPaymentSummary = { ...noDeposit, paidTotal: '8000.00', remainingOnPo: '0.00', payableOutstanding: '0.00', payableByAccount: {}, depositOutstanding: '2000.00', status: 'DEPOSIT_PAID' };

type Props = Parameters<typeof ClosePOShortDialog>[0];
function renderDialog(over: Partial<Props> = {}) {
  const props: Props = { open: true, po, summary: noDeposit, summaryLoading: false, pending: false, onClose: vi.fn(), onConfirm: vi.fn(), ...over };
  render(<ClosePOShortDialog {...props} />);
  return props;
}

// คำตัดสินเจ้าของ 2026-10-11 (mockup ปิดใบ รับไม่ครบ): เหตุผลบังคับ · บอกของที่จะไม่รับ + ผลกระทบ 3 ข้อ · มัดจำค้างต้องระบุผลแบบเดียวกับยกเลิก
describe('ClosePOShortDialog — ปิดใบ รับไม่ครบ', () => {
  it('บอกของที่จะไม่รับ (เฉพาะแถวที่รับไม่ครบ) + ผลกระทบ · ปุ่มปิดจนกว่าจะกรอกเหตุผล แล้วส่ง payload เหตุผลอย่างเดียวเมื่อไม่มีมัดจำ', () => {
    const p = renderDialog();
    expect(screen.getByRole('heading', { name: 'ปิดใบ รับไม่ครบ PO-2569-10-041' })).toBeInTheDocument();
    expect(screen.getByText(/รับแล้ว 3 \/ 6 ชิ้น/)).toBeInTheDocument();
    expect(screen.getByTestId('close-short-unreceived')).toHaveTextContent('3');
    expect(screen.getByText('Apple iPhone 13 128GB')).toBeInTheDocument();
    expect(screen.queryByText('เคส Spigen')).not.toBeInTheDocument(); // รับครบแล้ว ไม่อยู่ในรายการที่จะไม่รับ
    expect(screen.getByText(/ปิดแล้วแก้ไม่ได้/)).toBeInTheDocument();
    expect(screen.getByText(/จ่ายได้ไม่เกินมูลค่าของที่รับจริง/)).toBeInTheDocument();
    expect(screen.getByText(/15,000\.00/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: 'ยืนยันปิดใบ รับไม่ครบ' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /เหตุผลที่ปิดใบ/ }), { target: { value: '  ของหมด ไม่ส่งที่เหลือ  ' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(p.onConfirm).toHaveBeenCalledWith({ reason: 'ของหมด ไม่ส่งที่เหลือ' });
  });

  it('มีมัดจำค้าง → ต้องเลือกได้คืน/ไม่ได้คืนด้วย · ไม่ได้คืน: เหตุผลมัดจำแยกช่อง ส่งเป็น depositReason', () => {
    const p = renderDialog({ summary: withDeposit });
    expect(screen.getByText(/มัดจำค้าง/)).toBeInTheDocument();
    expect(screen.getAllByText(/2,000\.00/).length).toBeGreaterThan(0);
    const confirm = screen.getByRole('button', { name: 'ยืนยันปิดใบ รับไม่ครบ' });
    fireEvent.change(screen.getByRole('textbox', { name: /เหตุผลที่ปิดใบ/ }), { target: { value: 'ของหมด' } });
    expect(confirm).toBeDisabled(); // เหตุผลครบแต่ยังไม่เลือกผลมัดจำ
    fireEvent.click(screen.getByRole('radio', { name: 'ไม่ได้เงินมัดจำคืน' }));
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'เหตุผล' }), { target: { value: 'ผู้ขายริบมัดจำ' } });
    expect(screen.getByText('ค่าใช้จ่าย - มัดจำที่ไม่ได้คืน')).toBeInTheDocument();
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(p.onConfirm).toHaveBeenCalledWith({ reason: 'ของหมด', depositOutcome: 'FORFEITED', refundedAt: undefined, refundAmount: undefined, slipUrl: undefined, depositReason: 'ผู้ขายริบมัดจำ' });
  });

  it('ได้คืน → หลักฐานบังคับ · จำนวนเติมเท่ามัดจำค้าง · ส่ง REFUNDED ครบช่อง', () => {
    const p = renderDialog({ summary: withDeposit });
    fireEvent.change(screen.getByRole('textbox', { name: /เหตุผลที่ปิดใบ/ }), { target: { value: 'ของหมด' } });
    fireEvent.click(screen.getByRole('radio', { name: 'ได้เงินมัดจำคืน' }));
    expect((screen.getByRole('spinbutton', { name: 'จำนวนที่ได้คืน (บาท)' }) as HTMLInputElement).value).toBe('2,000');
    const confirm = screen.getByRole('button', { name: 'ยืนยันปิดใบ รับไม่ครบ' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'ลิงก์หลักฐานการโอนคืน' }), { target: { value: 'https://x/refund.jpg' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(p.onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'ของหมด', depositOutcome: 'REFUNDED', refundAmount: 2000, slipUrl: 'https://x/refund.jpg', refundedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
    );
  });

  it('กำลังโหลดฐานะ / กำลังส่ง → ปุ่มปิด · ปิดกล่องเรียก onClose', () => {
    renderDialog({ summaryLoading: true });
    fireEvent.change(screen.getByRole('textbox', { name: /เหตุผลที่ปิดใบ/ }), { target: { value: 'ของหมด' } });
    expect(screen.getByRole('button', { name: 'ยืนยันปิดใบ รับไม่ครบ' })).toBeDisabled();
  });
});
