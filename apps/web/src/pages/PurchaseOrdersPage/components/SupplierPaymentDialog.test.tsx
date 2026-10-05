import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SupplierPaymentDialog, VoidSupplierPaymentDialog } from './SupplierPaymentDialog';
import type { PurchaseOrder, SupplierPayment, SupplierPaymentSummary } from '../types';

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const po: PurchaseOrder = {
  id: 'po-1', poNumber: 'PO-2569-10-042', orderDate: '2026-10-01', expectedDate: null, orderedAt: null, dueDate: '2026-11-14',
  status: 'FULLY_RECEIVED', subtotal: '15000', vatAmount: '1029', totalAmount: '15000', discount: '300', discountAfterVat: '0', netAmount: '15729',
  paymentStatus: 'PARTIALLY_PAID', paymentMethod: 'BANK_TRANSFER', paidAmount: '5000', paymentNotes: null, attachments: [], notes: null,
  bankNameSnapshot: 'กสิกรไทย', bankAccountSnapshot: 'xxx-x-x1234-5',
  supplier: { id: 's1', name: 'บจก. โมบายล์ ดิสทริบิวชั่น', contactName: null, phone: '', hasVat: true },
  createdBy: { id: 'u1', name: 'เจ้าของ' }, approvedBy: null, items: [], _count: { products: 2 },
};
const settlementSummary: SupplierPaymentSummary = {
  netAmount: '15729.00', paidTotal: '5000.00', remainingOnPo: '10729.00', payableOutstanding: '10729.00',
  payableByAccount: { 'S21-1101': '10729.00' }, depositOutstanding: '0.00', hasBookedPayable: true, status: 'PARTIALLY_PAID',
};
const depositSummary: SupplierPaymentSummary = {
  netAmount: '15729.00', paidTotal: '0.00', remainingOnPo: '15729.00', payableOutstanding: '0.00',
  payableByAccount: {}, depositOutstanding: '0.00', hasBookedPayable: false, status: 'UNPAID',
};

type Props = Parameters<typeof SupplierPaymentDialog>[0];
function renderDialog(over: Partial<Props> = {}) {
  const props: Props = { open: true, po, summary: settlementSummary, summaryLoading: false, pending: false, onClose: vi.fn(), onSubmit: vi.fn(), ...over };
  render(<SupplierPaymentDialog {...props} />);
  return props;
}

describe('SupplierPaymentDialog — บันทึกการจ่ายเงินผู้จัดจำหน่าย (กระดาน 1/2)', () => {
  it('รับของแล้ว → ชิปชำระค่าสินค้า · ธนาคารล็อก S11-1202 · ปุ่มบันทึกปิดจนกว่าจะมีสลิป · ส่ง body ตาม API', () => {
    const p = renderDialog();
    expect(screen.getByRole('heading', { name: 'บันทึกการจ่ายเงิน PO-2569-10-042' })).toBeInTheDocument();
    expect(screen.getByText('ชำระค่าสินค้า · รับของแล้ว')).toBeInTheDocument();
    expect(screen.getAllByText(/S11-1202/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/โอนธนาคารเท่านั้น/).length).toBeGreaterThan(0);
    expect(screen.getByText(/กสิกรไทย/)).toBeInTheDocument();

    const amount = screen.getByRole('spinbutton', { name: 'จำนวนเงิน (บาท)' });
    expect((amount as HTMLInputElement).value).toBe('10729');
    const submit = screen.getByRole('button', { name: 'บันทึกและลงบัญชี' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'ลิงก์สลิป' }), { target: { value: 'https://files.example/slip.jpg' } });
    expect(submit).toBeEnabled();
    expect(screen.getByText('เจ้าหนี้ - ซัพพลายเออร์มือถือ')).toBeInTheDocument();
    expect(screen.getAllByText('10,729.00').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole('textbox', { name: 'เลขอ้างอิงการโอน' }), { target: { value: 'TXN-1' } });
    fireEvent.click(submit);
    expect(p.onSubmit).toHaveBeenCalledWith({ paidAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), amount: 10729, slipUrl: 'https://files.example/slip.jpg', reference: 'TXN-1', note: undefined });
  });

  it('จ่ายเกินเพดาน → ข้อความเตือน ปุ่มปิด', () => {
    renderDialog();
    fireEvent.change(screen.getByRole('textbox', { name: 'ลิงก์สลิป' }), { target: { value: 'https://x/slip.jpg' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'จำนวนเงิน (บาท)' }), { target: { value: '20000' } });
    expect(screen.getByText(/ไม่เกิน 10,729\.00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'บันทึกและลงบัญชี' })).toBeDisabled();
  });

  it('ยังไม่รับของ → ชิปมัดจำ + คำอธิบายหักอัตโนมัติ + พรีวิว S11-4201', () => {
    renderDialog({ summary: depositSummary });
    expect(screen.getByText('มัดจำ · ยังไม่รับของ')).toBeInTheDocument();
    expect(screen.getByText(/หักเข้าเจ้าหนี้ให้อัตโนมัติ/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'จำนวนเงิน (บาท)' }), { target: { value: '5000' } });
    expect(screen.getByText('เงินมัดจำจ่ายล่วงหน้า - ผู้จัดจำหน่าย')).toBeInTheDocument();
  });
});

describe('VoidSupplierPaymentDialog — ยกเลิกรายการที่บันทึกผิด', () => {
  const payment: SupplierPayment = {
    id: 'pay-1', kind: 'SETTLEMENT', amount: '10729.00', paidAt: '2026-10-04T17:00:00.000Z', postedAt: '2026-10-04T17:00:00.000Z',
    bankAccountCode: 'S11-1202', reference: null, slipUrl: null, note: null, receivingId: null, journalEntryId: 'je-1', journalEntryNo: 'S-JV-2569-0131',
    createdBy: { id: 'u1', name: 'เจ้าของ' }, createdAt: '2026-10-05T03:00:00.000Z', voidedAt: null, voidedBy: null, voidReason: null,
    reversalJournalEntryId: null, reversalJournalEntryNo: null,
  };
  it('เหตุผลบังคับ แล้วส่งเหตุผลกลับ', () => {
    const onConfirm = vi.fn();
    render(<VoidSupplierPaymentDialog open payment={payment} pending={false} onClose={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByText(/S-JV-2569-0131/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'ยืนยันยกเลิกรายการ' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /เหตุผล/ }), { target: { value: 'กรอกยอดผิด' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('กรอกยอดผิด');
  });
});
