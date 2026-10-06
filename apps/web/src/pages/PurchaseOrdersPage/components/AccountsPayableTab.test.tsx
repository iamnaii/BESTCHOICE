import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AccountsPayableTab } from './AccountsPayableTab';
import type { SupplierLedgerMovements, SupplierLedgerResponse } from '../types';

const ledger: SupplierLedgerResponse = {
  month: '2026-10',
  periodStart: '2026-09-30T17:00:00.000Z',
  periodEnd: '2026-10-31T17:00:00.000Z',
  totals: { closing: '128450.00', depositsOutstanding: '8000.00', dueWithin7Days: '102750.00', overdue: '0.00', supplierCount: 2, openPoCount: 3 },
  suppliers: [
    {
      supplier: { id: 's-b', name: 'ร้านเจมือถือ', hasVat: false },
      opening: '62000.00', receipts: '48500.00', payments: '30000.00', closing: '80500.00', payableByAccount: { 'S21-1101': '80500.00' },
      depositsOutstanding: '0.00', openPoCount: 2, nextDue: '2026-10-12T00:00:00.000Z', dueState: 'DUE_SOON',
      openPos: [
        { id: 'po-b1', poNumber: 'PO-2569-10-031', netAmount: '48500.00', paidAmount: '0.00', remaining: '48500.00', dueDate: '2026-10-12T00:00:00.000Z', status: 'FULLY_RECEIVED', paymentStatus: 'UNPAID' },
        { id: 'po-b2', poNumber: 'PO-2569-10-035', netAmount: '62000.00', paidAmount: '30000.00', remaining: '32000.00', dueDate: '2026-10-20T00:00:00.000Z', status: 'FULLY_RECEIVED', paymentStatus: 'PARTIALLY_PAID' },
      ],
    },
    {
      supplier: { id: 's-d', name: 'ร้านไอโฟนมือสอง สุขุมวิท', hasVat: false },
      opening: '0.00', receipts: '25700.00', payments: '0.00', closing: '25700.00', payableByAccount: { 'S21-1101': '25700.00' },
      depositsOutstanding: '8000.00', openPoCount: 1, nextDue: null, dueState: 'NONE',
      openPos: [{ id: 'po-d1', poNumber: 'PO-2569-10-040', netAmount: '25700.00', paidAmount: '0.00', remaining: '25700.00', dueDate: null, status: 'FULLY_RECEIVED', paymentStatus: 'UNPAID' }],
    },
  ],
};
const movements: SupplierLedgerMovements = {
  supplier: { id: 's-b', name: 'ร้านเจมือถือ', hasVat: false },
  month: '2026-10',
  opening: '62000.00',
  closing: '80500.00',
  rows: [
    { journalEntryId: 'je1', entryNumber: 'S-JV-2569-0117', entryDate: '2026-10-01T03:00:00.000Z', description: 'รับสินค้าเข้า GR-000031', kind: 'RECEIVING', poNumber: 'PO-2569-10-031', grNumber: 'GR-000031', paymentId: null, payableIncrease: '48500.00', payableDecrease: '0.00', depositChange: '0.00', running: '110500.00' },
    { journalEntryId: 'je2', entryNumber: 'S-JV-2569-0131', entryDate: '2026-10-05T17:00:00.000Z', description: 'ชำระค่าสินค้า', kind: 'SETTLEMENT', poNumber: 'PO-2569-10-035', grNumber: null, paymentId: 'p1', payableIncrease: '0.00', payableDecrease: '30000.00', depositChange: '0.00', running: '80500.00' },
  ],
};

type Props = Parameters<typeof AccountsPayableTab>[0];
function renderTab(over: Partial<Props> = {}) {
  const props: Props = {
    ledger, isLoading: false, month: '2026-10', setMonth: vi.fn(), selectedSupplierId: null, onSelectSupplier: vi.fn(),
    movements: undefined, movementsLoading: false, onOpenPo: vi.fn(), ...over,
  };
  render(<AccountsPayableTab {...props} />);
  return props;
}

describe('AccountsPayableTab — เจ้าหนี้รายผู้จัดจำหน่ายจากสมุดบัญชี (กระดาน 5)', () => {
  it('tiles รวม · แถวต่อผู้จัดจำหน่ายพร้อมยกมา/รับของ/จ่าย/คงเหลือ/มัดจำค้าง · กดแถวเลือกผู้จัดจำหน่าย', () => {
    const p = renderTab();
    expect(screen.getByText('128,450.00')).toBeInTheDocument();
    expect(screen.getByText('8,000.00', { selector: '[data-testid="tile-deposits"] *' })).toBeInTheDocument();
    expect(screen.getByText('102,750.00')).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /ร้านเจมือถือ/ });
    expect(row).toHaveTextContent('62,000.00');
    expect(row).toHaveTextContent('48,500.00');
    expect(row).toHaveTextContent('30,000.00');
    expect(row).toHaveTextContent('80,500.00');
    expect(row).toHaveTextContent('ใกล้ครบ');
    fireEvent.click(within(row).getByRole('button', { name: 'ร้านเจมือถือ' }));
    expect(p.onSelectSupplier).toHaveBeenCalledWith('s-b');
    expect(screen.getByText(/ยอดจากสมุดบัญชีหน้าร้าน/)).toBeInTheDocument();
  });

  it('เลือกผู้จัดจำหน่ายแล้ว → รายการเคลื่อนไหวไล่ยอดคงเหลือ + ใบค้างจ่ายพร้อมปุ่มเปิดใบ', () => {
    const p = renderTab({ selectedSupplierId: 's-b', movements });
    const panel = screen.getByRole('region', { name: /รายการเคลื่อนไหว/ });
    expect(panel).toHaveTextContent('ยกมา 62,000.00');
    expect(within(panel).getByText('รับของ')).toBeInTheDocument();
    expect(within(panel).getByText('ชำระค่าสินค้า')).toBeInTheDocument();
    expect(within(panel).getByText('S-JV-2569-0131')).toBeInTheDocument();
    expect(panel).toHaveTextContent('คงเหลือ 80,500.00');
    const open = screen.getByRole('region', { name: /ใบสั่งซื้อค้างจ่าย/ });
    expect(within(open).getByText('PO-2569-10-035')).toBeInTheDocument();
    fireEvent.click(within(open).getAllByRole('button', { name: /เปิดใบ/ })[0]);
    expect(p.onOpenPo).toHaveBeenCalledWith('po-b1');
  });

  it('เปลี่ยนเดือน → setMonth · ไม่มีข้อมูล → ข้อความว่าง', () => {
    const p = renderTab({ ledger: { ...ledger, suppliers: [], totals: { ...ledger.totals, closing: '0.00', depositsOutstanding: '0.00', dueWithin7Days: '0.00', overdue: '0.00', supplierCount: 0, openPoCount: 0 } } });
    fireEvent.change(screen.getByLabelText('เดือน'), { target: { value: '2026-09' } });
    expect(p.setMonth).toHaveBeenCalledWith('2026-09');
    expect(screen.getByText(/ไม่มีรายการเจ้าหนี้/)).toBeInTheDocument();
  });
});
