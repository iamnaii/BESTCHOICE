import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DirectReceiveModal } from './DirectReceiveModal';
import type { ItemForm } from '../types';

vi.mock('@/components/contacts/ContactCombobox', () => ({
  ContactCombobox: ({ value, placeholder }: { value: string; placeholder?: string }) => (
    <button type="button" role="combobox" aria-label="ผู้ขาย">
      {value || placeholder}
    </button>
  ),
}));
vi.mock('./ReceivingUnitCard', () => ({
  // The real card is covered by its own tests; here it is a label plus the two inputs the
  // summary-step gate needs (IMEI + selling price), wired to the modal's updater.
  ReceivingUnitCard: ({
    unit, idx, updateReceivingUnit,
  }: {
    unit: { label: string; category: string; costPrice: string };
    idx: number;
    updateReceivingUnit: (idx: number, field: string, value: string) => void;
  }) => (
    <div data-testid="unit">
      {`${unit.label} · ${unit.category} · ฿${unit.costPrice}`}
      <input aria-label={`IMEI ${unit.label}`} onChange={(e) => updateReceivingUnit(idx, 'imeiSerial', e.target.value)} />
      <input aria-label={`ราคาขาย ${unit.label}`} onChange={(e) => updateReceivingUnit(idx, 'sellingPrice', e.target.value)} />
    </div>
  ),
}));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const blank: ItemForm = {
  brand: '', category: '', model: '', color: '', storage: '', quantity: '1', unitPrice: '',
  accessoryType: '', accessoryBrand: '',
};
const phone: ItemForm = {
  ...blank, brand: 'Apple', category: 'PHONE_NEW', model: 'iPhone 17 Pro', color: 'Deep Blue', storage: '256GB',
  quantity: '2', unitPrice: '42900',
};
const film: ItemForm = {
  ...blank, category: 'ACCESSORY', accessoryType: 'F1601', accessoryBrand: 'iStar', model: 'ฟิล์มกระจก iPhone 16 - iStar',
  quantity: '1', unitPrice: '35', sourceName: 'ฟิล์มกระจก iPhone 16 - iStar', sourceCode: 'F1601', sourceInStock: 13,
};
const supplier = {
  id: 's1', name: 'ขนิษฐา คล้ายมณี', contactName: null, hasVat: false,
  paymentMethods: [{ paymentMethod: 'CASH', isDefault: true }],
};

type Props = Parameters<typeof DirectReceiveModal>[0];

function renderModal(over: Partial<Props> = {}) {
  const props: Props = {
    isOpen: true,
    onClose: vi.fn(),
    suppliers: [supplier],
    supplierId: 's1',
    onSupplierSelect: vi.fn(),
    lines: [phone, film],
    setLines: vi.fn(),
    notes: '',
    setNotes: vi.fn(),
    directReceiveMutation: { isPending: false, mutate: vi.fn() } as unknown as Props['directReceiveMutation'],
    searchAccessorySkus: vi.fn().mockResolvedValue([]),
    ...over,
  };
  render(<DirectReceiveModal {...props} />);
  return props;
}

describe('DirectReceiveModal — step 1 uses the PO items picker + table', () => {
  it('shows the supplier combobox, the catalog search and cost-price column labels', () => {
    renderModal();
    expect(screen.getByRole('combobox', { name: 'ผู้ขาย' })).toHaveTextContent('ขนิษฐา คล้ายมณี');
    expect(screen.getByRole('combobox', { name: 'ค้นหารุ่น' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'ราคาทุน/ชิ้น' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'รวมทุน' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /รายการ #1: iPhone 17 Pro/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /รายการ #2: ฟิล์มกระจก iPhone 16 - iStar/ })).toBeInTheDocument();
  });

  it('ถัดไป counts the pieces to inspect and is a plain button (never type=submit)', () => {
    renderModal();
    const next = screen.getByRole('button', { name: 'ถัดไป: ตรวจรับ 3 ชิ้น' });
    expect(next).toBeEnabled();
    expect(next).toHaveAttribute('type', 'button');
    expect(document.querySelector('button[type="submit"]')).toBeNull();
  });

  it('stays locked with a reason until a supplier is chosen and every row has a cost', () => {
    const { unmount } = render(<></>);
    unmount();
    renderModal({ supplierId: '', lines: [] });
    expect(screen.getByRole('button', { name: 'ถัดไป: ตรวจรับ' })).toBeDisabled();
    expect(screen.getByText('เลือกผู้ขายก่อน')).toBeInTheDocument();
  });

  it('names the missing cost when rows are incomplete', () => {
    renderModal({ lines: [{ ...phone, unitPrice: '' }] });
    expect(screen.getByRole('button', { name: 'ถัดไป: ตรวจรับ 2 ชิ้น' })).toBeDisabled();
    expect(screen.getByText('กรอกจำนวนและราคาทุนให้ครบทุกรายการ')).toBeInTheDocument();
  });
});

describe('DirectReceiveModal — ถัดไป expands rows into units for ตรวจรับ', () => {
  it('one unit per piece, labelled from the row; an existing SKU keeps its product name and cost', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป: ตรวจรับ 3 ชิ้น' }));
    expect(screen.getByRole('heading', { name: 'รับเข้าตรง — ตรวจรับ' })).toBeInTheDocument();
    const units = screen.getAllByTestId('unit').map((u) => u.textContent);
    expect(units).toEqual([
      'Apple iPhone 17 Pro Deep Blue 256GB #1 · PHONE_NEW · ฿42900',
      'Apple iPhone 17 Pro Deep Blue 256GB #2 · PHONE_NEW · ฿42900',
      'ฟิล์มกระจก iPhone 16 - iStar #1 · ACCESSORY · ฿35',
    ]);
    fireEvent.click(screen.getByRole('button', { name: /กลับไปแก้รายการ/ }));
    expect(screen.getByRole('combobox', { name: 'ค้นหารุ่น' })).toBeInTheDocument();
  });
});

describe('DirectReceiveModal — step 3 สรุป + จ่ายเงิน (owner 2026-09-06)', () => {
  const onePhone = { ...phone, quantity: '1' };
  const toSummary = () => {
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป: ตรวจรับ 2 ชิ้น' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'IMEI Apple iPhone 17 Pro Deep Blue 256GB #1' }), { target: { value: '356789012345678' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'ราคาขาย Apple iPhone 17 Pro Deep Blue 256GB #1' }), { target: { value: '45900' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'ราคาขาย ฟิล์มกระจก iPhone 16 - iStar #1' }), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป: สรุป + จ่ายเงิน' }));
  };

  it('the stepper has three steps and ตรวจรับ leads to the summary instead of submitting', () => {
    const p = renderModal({ lines: [onePhone, film] });
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('เพิ่มรายการ'), expect.stringContaining('ตรวจรับ'), expect.stringContaining('สรุป + จ่ายเงิน')]),
    );
    toSummary();
    expect(p.directReceiveMutation.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'รับเข้าตรง — สรุป + จ่ายเงิน' })).toBeInTheDocument();
    const recap = screen.getByRole('region', { name: 'สรุปใบสั่งซื้อ' });
    expect(recap).toHaveTextContent('รับเข้าวันนี้');
    expect(recap).toHaveTextContent('ผ่าน 2 ชิ้น');
    expect(screen.getByTestId('subtotal')).toHaveTextContent('42,935.00 บาท');
  });

  it('ยืนยัน sends the money and payment fields with the units (cash purchase paid in full)', () => {
    const p = renderModal({ lines: [onePhone, film] });
    toSummary();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'ส่วนลด' }), { target: { value: '35' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'สถานะการจ่าย' }), { target: { value: 'FULLY_PAID' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'หมายเหตุ' }), { target: { value: 'ซื้อสดหน้าร้าน' } });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันรับเข้าตรง 2 ชิ้น' }));
    expect(p.setNotes).toHaveBeenCalledWith('ซื้อสดหน้าร้าน');
    expect(p.directReceiveMutation.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        supplierId: 's1',
        discount: 35,
        paymentStatus: 'FULLY_PAID',
        paymentMethod: 'CASH',
        paidAmount: 42900,
        items: expect.arrayContaining([expect.objectContaining({ imeiSerial: '356789012345678', sellingPrice: '45900' })]),
      }),
    );
    expect(document.querySelector('button[type="submit"]')).toBeNull();
  });

  it('ย้อนกลับ from the summary returns to ตรวจรับ with the units intact', () => {
    renderModal({ lines: [onePhone, film] });
    toSummary();
    fireEvent.click(screen.getByRole('button', { name: 'ย้อนกลับ' }));
    expect(screen.getByRole('heading', { name: 'รับเข้าตรง — ตรวจรับ' })).toBeInTheDocument();
    expect(screen.getAllByTestId('unit')).toHaveLength(2);
  });
});
