/**
 * คำตัดสินเจ้าของ 2026-10-11 — หน้ารายละเอียดใบสั่งซื้อแบบดูอย่างเดียว (ผจก.การเงิน / ฝ่ายบัญชี):
 * ไม่มีปุ่ม รับสินค้า / ยกเลิก PO / บันทึกการจ่าย แต่ยังเปิดดูข้อมูลได้
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PODetailModal } from '../PODetailModal';
import type { PurchaseOrder } from '../../types';

vi.mock('@/lib/api', () => ({ __esModule: true, default: { get: vi.fn(), post: vi.fn() }, getErrorMessage: (e: unknown) => String(e) }));

const po = {
  id: 'po-1',
  poNumber: 'PO-1',
  orderDate: '2026-10-01T00:00:00.000Z',
  expectedDate: null,
  orderedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  dueDate: null,
  status: 'ORDERED',
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
} as PurchaseOrder;

const receiving = {
  id: 'gr-1',
  grNumber: 'GR-20261001-001',
  createdAt: '2026-10-02T03:00:00.000Z',
  notes: null,
  supplierDocType: 'DELIVERY_NOTE',
  supplierDocNumber: 'DN-1',
  supplierDocDate: '2026-10-01T17:00:00.000Z',
  receivedBy: { id: 'u1', name: 'ก' },
  items: [],
  taxInvoice: null,
} as never;

function renderModal(over: { readOnly?: boolean; canRecordPayments?: boolean; role?: string; withReceiving?: boolean }) {
  const { withReceiving, ...rest } = over;
  render(
    <MemoryRouter>
      <PODetailModal
        isOpen
        onClose={() => {}}
        selectedPO={po}
        poDetail={withReceiving ? ({ ...po, goodsReceivings: [receiving] } as never) : null}
        openReceiveModal={vi.fn()}
        openPaymentModal={vi.fn()}
        onCancel={vi.fn()}
        onRecordTaxInvoice={vi.fn()}
        role="ACCOUNTANT"
        {...rest}
      />
    </MemoryRouter>,
  );
}

describe('PODetailModal — ดูอย่างเดียว', () => {
  it('ไม่ readOnly (เจ้าของ/ผจก.สาขา): มีปุ่ม รับสินค้า / ยกเลิก PO / บันทึกการจ่าย', () => {
    renderModal({ readOnly: false, canRecordPayments: true });
    expect(screen.getAllByRole('button', { name: /รับสินค้า/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'ยกเลิก PO' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'บันทึกการจ่าย' }).length).toBeGreaterThan(0);
  });

  it('readOnly (ฝ่ายบัญชี): ไม่มีปุ่มกระทำ แต่ยังเห็นเลขใบสั่งซื้อ', () => {
    renderModal({ readOnly: true, canRecordPayments: false });
    expect(screen.queryByRole('button', { name: /รับสินค้า/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ยกเลิก PO' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'บันทึกการจ่าย' })).toBeNull();
    expect(screen.getAllByText('PO-1').length).toBeGreaterThan(0);
  });

  it('readOnly ไม่ซ่อนสิ่งที่ฝ่ายบัญชีทำได้: บันทึกใบกำกับภาษี (Q1) และพิมพ์ใบรับของ', () => {
    renderModal({ readOnly: true, canRecordPayments: false, role: 'ACCOUNTANT', withReceiving: true });
    expect(screen.getByRole('button', { name: 'บันทึกใบกำกับภาษี' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'พิมพ์ใบรับของ GR-20261001-001' })).toBeInTheDocument();
  });

  it('readOnly ผจก.การเงิน: พิมพ์ใบรับของได้ แต่ไม่มีปุ่มใบกำกับภาษี (API ไม่เปิดให้ FM)', () => {
    renderModal({ readOnly: true, canRecordPayments: false, role: 'FINANCE_MANAGER', withReceiving: true });
    expect(screen.getByRole('button', { name: 'พิมพ์ใบรับของ GR-20261001-001' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ใบกำกับภาษี/ })).toBeNull();
  });
});
