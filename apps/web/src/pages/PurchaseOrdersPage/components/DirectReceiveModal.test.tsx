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
  ReceivingUnitCard: ({ unit }: { unit: { label: string; category: string; costPrice: string } }) => (
    <div data-testid="unit">{`${unit.label} · ${unit.category} · ฿${unit.costPrice}`}</div>
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
