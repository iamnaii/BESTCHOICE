import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PODetailModal } from './PODetailModal';
import type { PODetail, PurchaseOrder } from '../types';

const owner = { id: 'u-owner', name: 'สุรชัย เจ้าของร้าน' };
const manager = { id: 'u-bm', name: 'สมชาย ผจก.ลาดพร้าว' };

const basePO = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po9',
  poNumber: 'PO-2026-09-009',
  orderDate: '2026-09-06',
  expectedDate: '2026-09-13',
  orderedAt: '2026-09-06T15:31:02.000Z',
  createdAt: '2026-09-06T15:31:00.000Z',
  dueDate: '2099-10-06',
  status: 'ORDERED',
  subtotal: '10000',
  vatAmount: '700',
  totalAmount: '10000',
  discount: '0',
  discountAfterVat: '0',
  netAmount: '10700',
  paymentStatus: 'UNPAID',
  paymentMethod: 'BANK_TRANSFER',
  paidAmount: '0',
  paymentNotes: null,
  attachments: [],
  notes: null,
  supplier: { id: 's1', name: 'บริษัท ไอเดียโมบาย จำกัด', contactName: 'คุณคิวเอ', phone: '02-555-0192', hasVat: true },
  createdBy: owner,
  approvedBy: null,
  items: [
    { id: 'it1', brand: 'Apple', model: 'iPhone 17 Pro', color: 'Silver', storage: '1TB', category: 'PHONE_NEW', quantity: 1, unitPrice: '10000', receivedQty: 0, accessoryType: null, accessoryBrand: null },
  ],
  _count: { products: 0 },
  ...over,
});

const renderModal = (po: PurchaseOrder, extra: Partial<React.ComponentProps<typeof PODetailModal>> = {}) => {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    selectedPO: po,
    poDetail: null as PODetail | null,
    openReceiveModal: vi.fn(),
    openPaymentModal: vi.fn(),
    ...extra,
  };
  render(
    <MemoryRouter>
      <PODetailModal {...props} />
    </MemoryRouter>,
  );
  return props;
};

describe('PODetailModal (redesign A)', () => {
  it('header carries the PO number with both state badges; the two tiles show goods and money progress', () => {
    renderModal(basePO());
    const dialog = screen.getByRole('dialog', { name: 'รายละเอียดใบสั่งซื้อ' });
    expect(within(dialog).getByRole('heading', { level: 2, name: 'PO-2026-09-009' })).toBeInTheDocument();
    expect(within(dialog).getAllByText('สั่งซื้อแล้ว').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('ยังไม่จ่าย').length).toBeGreaterThan(0);
    expect(screen.getByTestId('goods-progress')).toHaveTextContent('0 / 1');
    expect(screen.getByTestId('paid-progress')).toHaveTextContent('0');
    expect(screen.getByText(/ยังไม่ได้รับของ · คาดว่าจะได้รับ 13\/09\/2569/)).toBeInTheDocument();
    expect(screen.getByText(/คงค้าง 10,700 บาท/)).toBeInTheDocument();
    expect(screen.queryByText('รออนุมัติ')).not.toBeInTheDocument(); // the old 5-dot stepper is gone
  });

  it('items table uses the purchase wizard columns plus รับแล้ว; a device row shows สภาพ/ความจุ/สี', () => {
    renderModal(basePO());
    const table = within(screen.getByRole('region', { name: 'รายการสินค้า' })).getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['#', 'รุ่น', 'สภาพ', 'ความจุ', 'สี', 'จำนวน', 'ราคา/ชิ้น', 'รับแล้ว', 'รวม']);
    const row = within(table).getByRole('row', { name: 'รายการ #1' });
    expect(within(row).getByText('iPhone 17 Pro')).toBeInTheDocument();
    expect(within(row).getByText('Apple')).toBeInTheDocument();
    expect(within(row).getByText('ใหม่')).toBeInTheDocument();
    expect(within(row).getByText('1TB')).toBeInTheDocument();
    expect(within(row).getByText('Silver')).toBeInTheDocument();
    expect(within(row).getByText('0 / 1')).toBeInTheDocument();
    expect(screen.getByTestId('net-amount')).toHaveTextContent('10,700 บาท');
    expect(screen.getByText('รวม 1 รายการ · 1 ชิ้น')).toBeInTheDocument();
  });

  it('history collapses an owner-created PO into one "สร้างและสั่งซื้อ" event with the next-step hint', () => {
    renderModal(basePO());
    const history = screen.getByRole('region', { name: 'ประวัติ' });
    expect(within(history).getByText('สร้างและสั่งซื้อ')).toBeInTheDocument();
    expect(within(history).getByText(/โดย สุรชัย เจ้าของร้าน · สั่งซื้อทันทีโดยไม่ต้องอนุมัติ/)).toBeInTheDocument();
    expect(within(history).getByText(/ถัดไป: รับสินค้าเมื่อของมาถึง/)).toBeInTheDocument();
  });

  it('footer: ยกเลิก PO (when cancellable) · บันทึกการจ่าย · รับสินค้า call their handlers; all are plain buttons', () => {
    const onCancel = vi.fn();
    const p = renderModal(basePO(), { onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก PO' }));
    expect(onCancel).toHaveBeenCalledWith(expect.objectContaining({ id: 'po9' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'บันทึกการจ่าย' })[0]);
    expect(p.openPaymentModal).toHaveBeenCalledWith(expect.objectContaining({ id: 'po9' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'รับสินค้า' })[0]);
    expect(p.openReceiveModal).toHaveBeenCalledWith(expect.objectContaining({ id: 'po9' }));
    expect(document.querySelectorAll('button[type="submit"]')).toHaveLength(0);
  });

  it('a partially received PO with an accessory line: accessory row spans สภาพ/ความจุ/สี, QC tally shows, primary button counts what is left, GR appears in history with a print action', () => {
    const po = basePO({
      id: 'po6',
      poNumber: 'PO-2026-09-006',
      status: 'PARTIALLY_RECEIVED',
      paymentStatus: 'DEPOSIT_PAID',
      paidAmount: '14150',
      totalAmount: '44080',
      vatAmount: '3085.60',
      netAmount: '47165.60',
      createdBy: manager,
      approvedBy: owner,
      createdAt: '2026-09-06T13:41:00.000Z',
      orderedAt: '2026-09-06T13:55:00.000Z',
      notes: 'ล็อตนี้ขอเครื่องซีลใหม่เท่านั้น',
      items: [
        {
          id: 'it1', brand: 'Apple', model: 'iPhone 17 Pro', color: 'Deep Blue', storage: '256GB', category: 'PHONE_NEW', quantity: 1, unitPrice: '42900', receivedQty: 1, accessoryType: null, accessoryBrand: null,
          receivingItems: [{ id: 'ri1', status: 'PASS', product: { id: 'p1', status: 'QC_PENDING' } }],
        },
        { id: 'it2', brand: 'Spigen', model: 'iPhone 17 Pro', color: null, storage: null, category: 'ACCESSORY', quantity: 2, unitPrice: '590', receivedQty: 0, accessoryType: 'เคส', accessoryBrand: 'Spigen' },
      ],
    });
    const detail: PODetail = {
      ...po,
      goodsReceivings: [
        {
          id: 'gr1', grNumber: 'GR-2026-09-004', createdAt: '2026-09-06T14:10:00.000Z', notes: null, receivedBy: owner,
          items: [{ id: 'gi1', imeiSerial: '356000000090601', serialNumber: null, photos: [], status: 'PASS', rejectReason: null, product: null }],
        },
      ],
    };
    const p = renderModal(po, { poDetail: detail, onCancel: vi.fn() });

    const table = within(screen.getByRole('region', { name: 'รายการสินค้า' })).getByRole('table');
    const acc = within(table).getByRole('row', { name: 'รายการ #2' });
    expect(within(acc).getByText('เคส Spigen')).toBeInTheDocument();
    expect(within(acc).getByText('สำหรับรุ่น iPhone 17 Pro')).toBeInTheDocument();
    expect(within(acc).getByText('0 / 2')).toBeInTheDocument();
    const dev = within(table).getByRole('row', { name: 'รายการ #1' });
    expect(within(dev).getByText('1 / 1')).toBeInTheDocument();
    expect(within(dev).getByText('รอเข้าคลัง 1')).toBeInTheDocument();
    expect(screen.getByTestId('net-amount')).toHaveTextContent('47,165.60 บาท');
    expect(screen.getByTestId('goods-progress')).toHaveTextContent('1 / 3');
    expect(screen.getByTestId('paid-progress')).toHaveTextContent('14,150');
    expect(screen.getByText(/คงค้าง 33,015.60 บาท/)).toBeInTheDocument();

    // footer: received something already → the primary names what is left; cancel hidden once goods arrived
    fireEvent.click(screen.getByRole('button', { name: 'รับสินค้าที่เหลือ 2 ชิ้น' }));
    expect(p.openReceiveModal).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'ยกเลิก PO' })).not.toBeInTheDocument();

    const history = screen.getByRole('region', { name: 'ประวัติ' });
    const titles = within(history).getAllByRole('listitem').map((li) => li.querySelector('span.font-semibold')?.textContent);
    expect(titles).toEqual(['รับสินค้า GR-2026-09-004', 'อนุมัติและสั่งซื้อ', 'สร้างใบสั่งซื้อ']);
    expect(within(history).getByText('IMEI: 356000000090601')).toBeInTheDocument();
    expect(within(history).getByRole('button', { name: 'พิมพ์ใบรับของ GR-2026-09-004' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'หมายเหตุ' })).toHaveTextContent('ล็อตนี้ขอเครื่องซีลใหม่เท่านั้น');
  });

  it('closes from the X button and from Esc — but Esc is ignored while another dialog sits on top', () => {
    const p = renderModal(basePO());
    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'กลับ' })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(2);

    // a dialog rendered after this one (payment modal / confirm) is the one Esc should reach
    const top = document.createElement('div');
    top.setAttribute('role', 'dialog');
    document.body.appendChild(top);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(2);
    top.remove();
  });

  it('a cancelled PO has no footer actions and no tile buttons', () => {
    renderModal(basePO({ status: 'CANCELLED' }), { onCancel: vi.fn() });
    expect(screen.queryByRole('button', { name: 'รับสินค้า' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'บันทึกการจ่าย' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ยกเลิก PO' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'ประวัติ' })).getByText('ยกเลิกใบสั่งซื้อ')).toBeInTheDocument();
  });
});
