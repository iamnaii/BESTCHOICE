import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { POListTab } from './POListTab';
import type { PurchaseOrder } from '../types';

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const item = (over: Partial<PurchaseOrder['items'][number]>): PurchaseOrder['items'][number] => ({
  id: 'i1', brand: 'Apple', model: 'iPhone 17 Pro', color: 'Deep Blue', storage: '256GB', category: 'PHONE_NEW',
  quantity: 1, unitPrice: '42900', receivedQty: 0, accessoryType: null, accessoryBrand: null, ...over,
});
const po = (over: Partial<PurchaseOrder>): PurchaseOrder =>
  ({
    id: 'po-1', poNumber: 'PO-2026-09-010', orderDate: '2026-09-07', expectedDate: '2026-09-09', orderedAt: null, dueDate: null,
    status: 'PARTIALLY_RECEIVED', subtotal: '101000', vatAmount: '7070', totalAmount: '108070', discount: '0', discountAfterVat: '0',
    netAmount: '108070', paymentStatus: 'UNPAID', paymentMethod: null, paidAmount: '0', paymentNotes: null, attachments: [], notes: null,
    supplier: { id: 's1', name: '[ทดสอบระบบ] QA ผู้ขาย VAT เครดิต', contactName: 'คุณคิวเอ', phone: '', hasVat: true },
    createdBy: { id: 'u1', name: 'เจ้าของ' }, approvedBy: null,
    items: [item({ quantity: 2, receivedQty: 2 }), item({ id: 'i2', model: 'iPhone 15', category: 'PHONE_USED', receivedQty: 1 }), item({ id: 'i3', brand: '', category: 'ACCESSORY', accessoryType: 'เคส', accessoryBrand: 'Spigen', quantity: 2, receivedQty: 1 })],
    _count: { products: 4 },
    ...over,
  }) as PurchaseOrder;

const mut = { isPending: false, mutate: vi.fn() } as never;
function renderTab(pos: PurchaseOrder[]) {
  const openDetailModal = vi.fn();
  render(
    <POListTab
      statusFilter=""
      setStatusFilter={vi.fn()}
      pos={pos}
      isLoading={false}
      openDetailModal={openDetailModal}
      openReceiveModal={vi.fn()}
      openPaymentModal={vi.fn()}
      approveMutation={mut}
      orderMutation={mut}
      rejectPOMutation={mut}
      cancelMutation={mut}
      setConfirmDialog={vi.fn()}
      suppliers={[{ id: 's1', name: 'QA' }]}
      overdueOnly={false}
      setOverdueOnly={vi.fn()}
    />,
  );
  return { openDetailModal };
}

describe('POListTab — desktop table cells that never wrap', () => {
  it('folds the order date under the PO number, lifts the test tag off the supplier and summarises the lines', () => {
    renderTab([po({})]);
    const row = screen.getByRole('button', { name: 'PO-2026-09-010' }).closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('สั่ง 07/09/2569');
    expect(within(row).getByTitle('[ทดสอบระบบ] QA ผู้ขาย VAT เครดิต')).toHaveTextContent('QA ผู้ขาย VAT เครดิต');
    expect(within(row).getByText('ทดสอบระบบ')).toBeInTheDocument();
    expect(within(row).getByText('คุณคิวเอ')).toBeInTheDocument();
    expect(row).toHaveTextContent('3 รายการ · 5 ชิ้น');
    expect(within(row).getByTitle('iPhone 17 Pro ×2, iPhone 15, เคส Spigen ×2')).toBeInTheDocument();
    expect(row).toHaveTextContent('108,070');
    expect(row).toHaveTextContent('รวม VAT 7,070');
    expect(within(row).getByText('รับบางส่วน')).toHaveClass('whitespace-nowrap');
    expect(within(row).getByText('ยังไม่จ่าย')).toHaveClass('whitespace-nowrap');
    expect(row).toHaveTextContent('4/5');
    expect(within(row).getByRole('button', { name: 'รับสินค้า PO-2026-09-010' })).toBeInTheDocument();
    // no separate date column any more
    expect(screen.queryByRole('columnheader', { name: /วันที่สั่ง/ })).not.toBeInTheDocument();
  });

  it('shows ไม่มี VAT, the overdue badge and the pinned action rail', () => {
    renderTab([
      po({ id: 'po-2', poNumber: 'PO-2026-09-009', status: 'ORDERED', vatAmount: '0', netAmount: '10000', totalAmount: '10000', expectedDate: '2026-01-01', supplier: { id: 's2', name: 'บริษัท ไอเดียโมบาย จำกัด', contactName: null, phone: '', hasVat: false }, items: [item({ model: 'iPhone 14', category: 'PHONE_USED' })] }),
    ]);
    const row = screen.getByRole('button', { name: 'PO-2026-09-009' }).closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('ไม่มี VAT');
    expect(within(row).getByText('เลยกำหนด')).toHaveClass('whitespace-nowrap');
    expect(row).toHaveTextContent('1 รายการ · 1 ชิ้น');
    expect(within(row).getByTitle('iPhone 14 · มือสอง')).toBeInTheDocument();
    expect(screen.queryByText('ทดสอบระบบ')).not.toBeInTheDocument();
    const actions = within(row).getByRole('button', { name: 'ยกเลิก PO-2026-09-009' }).closest('td') as HTMLElement;
    expect(actions.className).toContain('sticky');
  });
});

describe('POListTab — sorting after the date moved under the PO number', () => {
  it('sorting by เลข PO orders by the order date, not by the PO string (two number formats coexist)', () => {
    renderTab([
      po({ id: 'a', poNumber: 'PO-2026-09-011', orderDate: '2026-09-07' }),
      po({ id: 'b', poNumber: 'PO-2026-003', orderDate: '2026-03-01' }),
      po({ id: 'c', poNumber: 'PO-2026-09-002', orderDate: '2026-06-06' }),
    ]);
    const order = () => screen.getAllByRole('button', { name: /^PO-2026/ }).map((b) => b.textContent);
    fireEvent.click(screen.getByRole('columnheader', { name: /เลข PO/ }));
    expect(order()).toEqual(['PO-2026-003', 'PO-2026-09-002', 'PO-2026-09-011']);
    fireEvent.click(screen.getByRole('columnheader', { name: /เลข PO/ }));
    expect(order()).toEqual(['PO-2026-09-011', 'PO-2026-09-002', 'PO-2026-003']);
  });

  it('sorting by ผู้จัดจำหน่าย orders by the supplier name', () => {
    renderTab([
      po({ id: 'a', poNumber: 'PO-2026-09-011', supplier: { id: 's1', name: 'iCare Refurbished', contactName: null, phone: '', hasVat: false } }),
      po({ id: 'b', poNumber: 'PO-2026-09-010', supplier: { id: 's2', name: 'Anker Official TH', contactName: null, phone: '', hasVat: false } }),
    ]);
    fireEvent.click(screen.getByRole('columnheader', { name: /ผู้จัดจำหน่าย/ }));
    expect(screen.getAllByRole('button', { name: /^PO-2026/ }).map((b) => b.textContent)).toEqual(['PO-2026-09-010', 'PO-2026-09-011']);
  });
});
