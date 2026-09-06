import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { StepItems } from './StepItems';
import type { ItemForm } from '../../types';

// cmdk calls scrollIntoView on list items; jsdom doesn't implement it
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const blank: ItemForm = {
  brand: '', category: '', model: '', color: '', storage: '', quantity: '1', unitPrice: '',
  accessoryType: '', accessoryBrand: '',
};
const iphone16pro: ItemForm = { ...blank, brand: 'Apple', model: 'iPhone 16 Pro', category: 'PHONE_NEW' };
const caseItem: ItemForm = { ...blank, brand: 'Apple', category: 'ACCESSORY', accessoryType: 'เคส' };
const charger: ItemForm = { ...blank, brand: 'Apple', category: 'ACCESSORY', accessoryType: 'ชุดชาร์จ' };

function renderStep(items: ItemForm[], overrides: Partial<Parameters<typeof StepItems>[0]> = {}) {
  const props = {
    items,
    updateItem: vi.fn(),
    toggleModel: vi.fn(),
    removeItem: vi.fn(),
    duplicateItem: vi.fn(),
    addCatalogItem: vi.fn(),
    addAccessoryItem: vi.fn(),
    subtotal: 0,
    ...overrides,
  };
  render(<StepItems {...props} />);
  return props;
}

/** Table row for line n — every line is one <tr> so the columns line up across rows. */
const row = (n: number) => within(screen.getByRole('row', { name: new RegExp(`^รายการ #${n}`) }));

describe('StepItems — picker (search first)', () => {
  it('empty state shows the search box and one-click latest models', () => {
    const p = renderStep([]);
    expect(screen.getByRole('combobox', { name: 'ค้นหารุ่น' })).toBeInTheDocument();
    expect(screen.getByText('ยังไม่มีรายการ')).toBeInTheDocument();
    const latest = within(screen.getByRole('group', { name: 'รุ่นล่าสุด' }));
    fireEvent.click(latest.getByRole('button', { name: 'iPhone 17 Pro Max' }));
    expect(p.addCatalogItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'iPhone 17 Pro Max', brand: 'Apple' }), 'PHONE_NEW');
  });

  it('typing filters the catalog and picking a result adds it with the active new/used mode', () => {
    const p = renderStep([]);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'ประเภทสินค้า' })).getByRole('radio', { name: 'มือสอง' }));
    const input = screen.getByRole('combobox', { name: 'ค้นหารุ่น' });
    fireEvent.change(input, { target: { value: '16 pro' } });
    expect(screen.getByRole('option', { name: 'iPhone 16 Pro' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'iPhone 16 Pro Max' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'iPhone 15 Pro' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'iPhone 16 Pro' }));
    expect(p.addCatalogItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'iPhone 16 Pro' }), 'PHONE_USED');
    expect(input).toHaveValue(''); // cleared so the next model can be typed straight away
  });

  it('tablet mode searches tablets only', () => {
    renderStep([]);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'ประเภทสินค้า' })).getByRole('radio', { name: 'แท็บเล็ต' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'ค้นหารุ่น' }), { target: { value: 'air' } });
    expect(screen.queryByRole('option', { name: 'iPhone Air' })).toBeNull();
    expect(screen.getByRole('option', { name: 'iPad Air 11" (M3)' })).toBeInTheDocument();
  });

  it('accessory mode offers accessory types instead of models', () => {
    const p = renderStep([]);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'ประเภทสินค้า' })).getByRole('radio', { name: 'อุปกรณ์เสริม' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'ประเภทอุปกรณ์' })).getByRole('button', { name: 'เคส' }));
    expect(p.addAccessoryItem).toHaveBeenCalledWith('เคส');
  });
});

describe('StepItems — table layout', () => {
  it('renders one column header per field so every row lines up', () => {
    renderStep([iphone16pro]);
    for (const h of ['รุ่น', 'ความจุ', 'สี', 'จำนวน', 'ราคา/ชิ้น', 'รวม']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
  });
});

describe('StepItems — device row', () => {
  it('storage and colour selects list the catalog options and report picks', () => {
    const p = renderStep([iphone16pro]);
    const r = row(1);
    expect(r.getByText('iPhone 16 Pro')).toBeInTheDocument();
    const storage = r.getByRole('combobox', { name: 'ความจุ' });
    expect(within(storage).getAllByRole('option').map((o) => o.textContent)).toEqual(['— ความจุ —', '128GB', '256GB', '512GB', '1TB']);
    fireEvent.change(storage, { target: { value: '256GB' } });
    expect(p.updateItem).toHaveBeenCalledWith(0, 'storage', '256GB');
    fireEvent.change(r.getByRole('combobox', { name: 'สี' }), { target: { value: 'Black Titanium' } });
    expect(p.updateItem).toHaveBeenCalledWith(0, 'color', 'Black Titanium');
  });

  it('shows the chosen storage as the select value', () => {
    renderStep([{ ...iphone16pro, storage: '512GB' }]);
    expect(row(1).getByRole('combobox', { name: 'ความจุ' })).toHaveValue('512GB');
  });

  it('new/used toggle updates the category', () => {
    const p = renderStep([iphone16pro]);
    fireEvent.click(within(row(1).getByRole('radiogroup', { name: 'สภาพ' })).getByRole('radio', { name: 'มือสอง' }));
    expect(p.updateItem).toHaveBeenCalledWith(0, 'category', 'PHONE_USED');
  });

  it('quantity stepper: + increments, − is disabled at 1', () => {
    const p = renderStep([iphone16pro]);
    const r = row(1);
    expect(r.getByRole('button', { name: 'ลดจำนวน' })).toBeDisabled();
    fireEvent.click(r.getByRole('button', { name: 'เพิ่มจำนวน' }));
    expect(p.updateItem).toHaveBeenCalledWith(0, 'quantity', '2');
  });

  it('price input reports the unit price and the row shows its line total', () => {
    const p = renderStep([{ ...iphone16pro, quantity: '2', unitPrice: '42900' }]);
    const r = row(1);
    expect(r.getByText('85,800.00')).toBeInTheDocument();
    fireEvent.change(r.getByRole('spinbutton', { name: 'ราคาต่อชิ้น' }), { target: { value: '39900' } });
    expect(p.updateItem).toHaveBeenCalledWith(0, 'unitPrice', '39900');
  });

  it('duplicate and remove buttons call through with the row index', () => {
    const p = renderStep([iphone16pro, { ...iphone16pro, model: 'iPhone 16' }]);
    fireEvent.click(row(2).getByRole('button', { name: 'ทำซ้ำรายการ' }));
    expect(p.duplicateItem).toHaveBeenCalledWith(1);
    fireEvent.click(row(2).getByRole('button', { name: 'ลบรายการ' }));
    expect(p.removeItem).toHaveBeenCalledWith(1);
  });
});

describe('StepItems — accessory row', () => {
  it('charger row offers connector chips', () => {
    const p = renderStep([charger]);
    fireEvent.click(within(row(1).getByRole('radiogroup', { name: 'ชนิดหัวชาร์จ' })).getByRole('radio', { name: 'Type-C' }));
    expect(p.updateItem).toHaveBeenCalledWith(0, 'model', 'Type-C');
  });

  it('case row: type select, brand input and compatible-model picker', () => {
    const p = renderStep([{ ...caseItem, model: 'iPhone 16' }]);
    const r = row(1);
    fireEvent.change(r.getByRole('combobox', { name: 'ประเภทอุปกรณ์' }), { target: { value: 'ฟิล์ม' } });
    expect(p.updateItem).toHaveBeenCalledWith(0, 'accessoryType', 'ฟิล์ม');
    fireEvent.change(r.getByRole('textbox', { name: 'ยี่ห้ออุปกรณ์' }), { target: { value: 'Spigen' } });
    expect(p.updateItem).toHaveBeenCalledWith(0, 'accessoryBrand', 'Spigen');
    expect(r.getByText('iPhone 16')).toBeInTheDocument(); // selected model chip
    fireEvent.click(r.getByRole('button', { name: 'เลือกรุ่นที่รองรับ' }));
    fireEvent.click(screen.getByRole('option', { name: 'iPhone 16 Pro' }));
    expect(p.toggleModel).toHaveBeenCalledWith(0, 'iPhone 16 Pro');
  });
});

describe('StepItems — footer', () => {
  it('sums rows and pieces', () => {
    renderStep([{ ...iphone16pro, quantity: '2' }, { ...caseItem, quantity: '10' }], { subtotal: 87300 });
    expect(screen.getByText(/รวม 2 รายการ · 12 ชิ้น/)).toBeInTheDocument();
    expect(screen.getByText('87,300.00 บาท')).toBeInTheDocument();
  });
});
