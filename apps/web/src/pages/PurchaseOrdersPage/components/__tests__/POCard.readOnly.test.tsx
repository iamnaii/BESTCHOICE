/**
 * คำตัดสินเจ้าของ 2026-10-11 — ผจก.การเงิน / ฝ่ายบัญชี เข้าหน้าใบสั่งซื้อแบบ "ดูอย่างเดียว":
 * การ์ด PO ต้องไม่มีปุ่ม สั่งซื้อ / รับสินค้า / อนุมัติ / ปฏิเสธ / ยกเลิก (API ตอบ 403 ให้สอง role นี้อยู่แล้ว)
 * แต่ยังแตะการ์ดเพื่อดูรายละเอียดได้
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { POCard } from '../POCard';
import type { PurchaseOrder } from '../../types';

const po = (over: Partial<PurchaseOrder>): PurchaseOrder =>
  ({
    id: 'po-1',
    poNumber: 'PO-1',
    orderDate: '2026-10-01T00:00:00.000Z',
    expectedDate: null,
    orderedAt: null,
    dueDate: null,
    status: 'APPROVED',
    subtotal: '10000',
    vatAmount: '700',
    totalAmount: '10700',
    discount: '0',
    discountAfterVat: '0',
    netAmount: '10700',
    paymentStatus: 'UNPAID',
    paymentMethod: null,
    paidAmount: '0',
    paymentNotes: null,
    attachments: [],
    notes: null,
    supplier: { id: 's1', name: 'ร้าน A', contactName: null, phone: '', hasVat: true },
    createdBy: { id: 'u1', name: 'ก' },
    approvedBy: null,
    items: [{ id: 'i1', brand: 'Apple', model: 'iPhone', color: null, storage: null, category: 'PHONE_NEW', quantity: 2, unitPrice: '5000', receivedQty: 0, accessoryType: null, accessoryBrand: null }],
    _count: { products: 0 },
    ...over,
  }) as PurchaseOrder;

function renderCard(p: PurchaseOrder, readOnly: boolean, canApprove = true) {
  const handlers = { openDetailModal: vi.fn(), openReceiveModal: vi.fn(), onApprove: vi.fn(), onOrder: vi.fn(), onReject: vi.fn(), onCancel: vi.fn() };
  render(<POCard po={p} {...handlers} approvePending={false} orderPending={false} rejectPending={false} readOnly={readOnly} canApprove={canApprove} />);
  return handlers;
}

describe('POCard — ดูอย่างเดียว', () => {
  it('ไม่ readOnly: ใบที่อนุมัติแล้วมีปุ่ม สั่งซื้อ / รับสินค้า / ยกเลิก', () => {
    renderCard(po({ status: 'APPROVED' }), false);
    expect(screen.getByRole('button', { name: 'สั่งซื้อ PO-1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'รับสินค้า PO-1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ยกเลิก PO-1' })).toBeInTheDocument();
  });

  it('readOnly: ใบที่อนุมัติแล้วไม่มีปุ่มกระทำเลย แต่แตะการ์ดเปิดรายละเอียดได้', () => {
    const h = renderCard(po({ status: 'APPROVED' }), true);
    expect(screen.queryByRole('button', { name: 'สั่งซื้อ PO-1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'รับสินค้า PO-1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ยกเลิก PO-1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'PO-1' }));
    expect(h.openDetailModal).toHaveBeenCalledWith(expect.objectContaining({ id: 'po-1' }));
  });

  it('เจ้าของ: ใบรออนุมัติมีปุ่ม อนุมัติ / ปฏิเสธ · ผจก.สาขา (canApprove=false) ไม่มี — API @Roles(OWNER)', () => {
    renderCard(po({ status: 'DRAFT' }), false);
    expect(screen.getByRole('button', { name: 'อนุมัติ PO-1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ปฏิเสธ PO-1' })).toBeInTheDocument();
    cleanup();
    renderCard(po({ status: 'DRAFT' }), false, false);
    expect(screen.queryByRole('button', { name: 'อนุมัติ PO-1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ปฏิเสธ PO-1' })).toBeNull();
  });

  it('readOnly: ใบรออนุมัติไม่มีปุ่ม อนุมัติ / ปฏิเสธ', () => {
    renderCard(po({ status: 'DRAFT' }), true);
    expect(screen.queryByRole('button', { name: 'อนุมัติ PO-1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ปฏิเสธ PO-1' })).toBeNull();
  });
});
