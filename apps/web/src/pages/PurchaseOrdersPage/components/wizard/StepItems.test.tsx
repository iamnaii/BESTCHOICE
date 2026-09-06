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
const film: ItemForm = { ...blank, brand: 'Apple', category: 'ACCESSORY', accessoryType: 'ฟิล์ม', accessoryBrand: 'Hoco', model: 'iPhone 16 Pro, iPhone 17 Pro' };
const earphone: ItemForm = { ...blank, category: 'ACCESSORY', accessoryType: 'หูฟัง', accessoryBrand: 'Apple' };
const other: ItemForm = { ...blank, category: 'ACCESSORY', accessoryType: 'อื่นๆ' };
const existing: ItemForm = {
  ...blank, category: 'ACCESSORY', accessoryType: 'F1601', accessoryBrand: 'iStar', model: 'ฟิล์มกระจก iPhone 16 - iStar',
  unitPrice: '35', sourceName: 'ฟิล์มกระจก iPhone 16 - iStar', sourceCode: 'F1601', sourceInStock: 13,
};
const skuF1601 = { code: 'F1601', name: 'ฟิล์มกระจก iPhone 16 - iStar', accessoryType: 'F1601', accessoryBrand: 'iStar', model: 'ฟิล์มกระจก iPhone 16 - iStar', inStock: 13, lastCost: 35 };

function renderStep(items: ItemForm[], overrides: Partial<Parameters<typeof StepItems>[0]> = {}) {
  const props = {
    items,
    updateItem: vi.fn(),
    toggleModel: vi.fn(),
    removeItem: vi.fn(),
    duplicateItem: vi.fn(),
    addCatalogItem: vi.fn(),
    addAccessoryItem: vi.fn(),
    addExistingAccessoryItem: vi.fn(),
    searchAccessorySkus: vi.fn().mockResolvedValue([skuF1601]),
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

  it('mode chips are โทรศัพท์ / แท็บเล็ต / อุปกรณ์เสริม — new vs used is chosen per row, not here', () => {
    renderStep([]);
    const radios = within(screen.getByRole('radiogroup', { name: 'ประเภทสินค้า' })).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['โทรศัพท์', 'แท็บเล็ต', 'อุปกรณ์เสริม']);
  });

  it('typing filters the catalog and picking a result adds it as a new phone', () => {
    const p = renderStep([]);
    const input = screen.getByRole('combobox', { name: 'ค้นหารุ่น' });
    fireEvent.change(input, { target: { value: '16 pro' } });
    expect(screen.getByRole('option', { name: 'iPhone 16 Pro' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'iPhone 16 Pro Max' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'iPhone 15 Pro' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'iPhone 16 Pro' }));
    expect(p.addCatalogItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'iPhone 16 Pro' }), 'PHONE_NEW');
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

  it('accessory mode: searching existing products by name/code and picking one re-orders it', async () => {
    const p = renderStep([]);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'ประเภทสินค้า' })).getByRole('radio', { name: 'อุปกรณ์เสริม' }));
    const input = screen.getByRole('combobox', { name: 'ค้นหาสินค้าเดิม' });
    fireEvent.change(input, { target: { value: '16' } });
    const opt = await screen.findByRole('option', { name: 'ฟิล์มกระจก iPhone 16 - iStar' });
    expect(p.searchAccessorySkus).toHaveBeenCalledWith('16');
    expect(opt).toHaveTextContent('F1601');
    expect(opt).toHaveTextContent('คงเหลือ 13');
    fireEvent.click(opt);
    expect(p.addExistingAccessoryItem).toHaveBeenCalledWith(skuF1601);
    expect(input).toHaveValue('');
  });
});

describe('StepItems — when the results list opens (owner feedback 2026-09-06)', () => {
  const search = () => screen.getByRole('combobox', { name: 'ค้นหารุ่น' });

  it('latest chip adds the row without opening the results list', () => {
    const p = renderStep([]);
    fireEvent.click(within(screen.getByRole('group', { name: 'รุ่นล่าสุด' })).getByRole('button', { name: 'iPhone 17 Pro' }));
    expect(p.addCatalogItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'iPhone 17 Pro' }), 'PHONE_NEW');
    expect(screen.queryByRole('option')).toBeNull();
    expect(search()).not.toHaveFocus();
  });

  it('after a latest-chip add, focus moves to the new row’s storage select', () => {
    const props = {
      items: [iphone16pro], updateItem: vi.fn(), toggleModel: vi.fn(), removeItem: vi.fn(), duplicateItem: vi.fn(),
      addCatalogItem: vi.fn(), addAccessoryItem: vi.fn(), addExistingAccessoryItem: vi.fn(),
      searchAccessorySkus: vi.fn().mockResolvedValue([]), subtotal: 0,
    };
    const { rerender } = render(<StepItems {...props} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'รุ่นล่าสุด' })).getByRole('button', { name: 'iPhone 17 Pro' }));
    // the parent appends the row on the next render
    const added: ItemForm = { ...blank, brand: 'Apple', model: 'iPhone 17 Pro', category: 'PHONE_NEW' };
    rerender(<StepItems {...props} items={[iphone16pro, added]} />);
    expect(row(2).getByRole('combobox', { name: 'ความจุ' })).toHaveFocus();
  });

  it('focus alone keeps the list closed; click, typing or ArrowDown opens it', () => {
    renderStep([]);
    fireEvent.focus(search());
    expect(screen.queryByRole('option')).toBeNull();
    fireEvent.click(search());
    expect(screen.queryAllByRole('option').length).toBeGreaterThan(0);
    fireEvent.keyDown(search(), { key: 'Escape' });
    expect(screen.queryByRole('option')).toBeNull();
    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    expect(screen.queryAllByRole('option').length).toBeGreaterThan(0);
  });

  it('picking from the list keeps focus in the search box with the list closed', () => {
    renderStep([]);
    fireEvent.change(search(), { target: { value: '16 pro' } });
    fireEvent.click(screen.getByRole('option', { name: 'iPhone 16 Pro' }));
    expect(search()).toHaveFocus();
    expect(search()).toHaveValue('');
    expect(screen.queryByRole('option')).toBeNull();
  });
});

describe('StepItems — table layout', () => {
  it('renders one column header per field so every row lines up', () => {
    renderStep([iphone16pro]);
    for (const h of ['รุ่น', 'สภาพ', 'ความจุ', 'สี', 'จำนวน', 'ราคา/ชิ้น', 'รวม']) {
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

  it('สภาพ column is a ใหม่/มือสอง select that updates the category', () => {
    const p = renderStep([iphone16pro]);
    const cond = row(1).getByRole('combobox', { name: 'สภาพ' });
    expect(within(cond).getAllByRole('option').map((o) => o.textContent)).toEqual(['ใหม่', 'มือสอง']);
    expect(cond).toHaveValue('PHONE_NEW');
    fireEvent.change(cond, { target: { value: 'PHONE_USED' } });
    expect(p.updateItem).toHaveBeenCalledWith(0, 'category', 'PHONE_USED');
  });

  it('tablet rows show แท็บเล็ต in the สภาพ column instead of the select', () => {
    renderStep([{ ...blank, brand: 'Apple', model: 'iPad (10th gen)', category: 'TABLET' }]);
    const r = row(1);
    expect(r.queryByRole('combobox', { name: 'สภาพ' })).toBeNull();
    expect(r.getByText('แท็บเล็ต')).toBeInTheDocument();
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

describe('StepItems — accessory rows (one line each, type fixed from the chip)', () => {
  it('shows the type as text (no type select) with a brand input', () => {
    const p = renderStep([caseItem]);
    const r = row(1);
    expect(r.queryByRole('combobox', { name: 'ประเภทอุปกรณ์' })).toBeNull();
    expect(r.getByText('เคส')).toBeInTheDocument();
    fireEvent.change(r.getByRole('textbox', { name: 'ยี่ห้ออุปกรณ์' }), { target: { value: 'Spigen' } });
    expect(p.updateItem).toHaveBeenCalledWith(0, 'accessoryBrand', 'Spigen');
  });

  it('เคส: one compatible model from a select', () => {
    const p = renderStep([caseItem]);
    const sel = row(1).getByRole('combobox', { name: 'สำหรับรุ่น' });
    expect(within(sel).getByRole('option', { name: 'iPhone 16 Pro' })).toBeInTheDocument();
    fireEvent.change(sel, { target: { value: 'iPhone 16 Pro' } });
    expect(p.updateItem).toHaveBeenCalledWith(0, 'model', 'iPhone 16 Pro');
  });

  it('ฟิล์ม: one box listing the chosen models with a count, opening a multi-pick list', () => {
    const p = renderStep([film]);
    const btn = row(1).getByRole('button', { name: 'สำหรับรุ่น' });
    expect(btn).toHaveTextContent('iPhone 16 Pro, iPhone 17 Pro');
    expect(btn).toHaveTextContent('2');
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole('option', { name: 'iPhone 17 Pro Max' }));
    expect(p.toggleModel).toHaveBeenCalledWith(0, 'iPhone 17 Pro Max');
  });

  it('ชุดชาร์จ: connector select', () => {
    const p = renderStep([charger]);
    fireEvent.change(row(1).getByRole('combobox', { name: 'หัวชาร์จ' }), { target: { value: 'Type-C' } });
    expect(p.updateItem).toHaveBeenCalledWith(0, 'model', 'Type-C');
  });

  it('หูฟัง / อื่นๆ: free-text model / detail', () => {
    const p = renderStep([earphone, other]);
    fireEvent.change(row(1).getByRole('textbox', { name: 'รุ่น' }), { target: { value: 'AirPods Pro 2' } });
    expect(p.updateItem).toHaveBeenCalledWith(0, 'model', 'AirPods Pro 2');
    fireEvent.change(row(2).getByRole('textbox', { name: 'รายละเอียด' }), { target: { value: 'สายชาร์จ 1 ม.' } });
    expect(p.updateItem).toHaveBeenCalledWith(1, 'model', 'สายชาร์จ 1 ม.');
  });

  it('re-ordered existing product: name + code read-only, stock caption, nothing else to pick', () => {
    const p = renderStep([existing]);
    const r = row(1);
    expect(r.getByText('ฟิล์มกระจก iPhone 16 - iStar')).toBeInTheDocument();
    expect(r.getByText(/สินค้าเดิม · iStar · คงเหลือ 13 ชิ้น/)).toBeInTheDocument();
    expect(r.getByLabelText('รหัสสินค้า')).toHaveValue('F1601');
    expect(r.getByLabelText('รหัสสินค้า')).toHaveAttribute('readonly');
    expect(r.queryByRole('textbox', { name: 'ยี่ห้ออุปกรณ์' })).toBeNull();
    expect(r.getByRole('spinbutton', { name: 'ราคาต่อชิ้น' })).toHaveValue(35);
    fireEvent.click(r.getByRole('button', { name: 'เพิ่มจำนวน' }));
    expect(p.updateItem).toHaveBeenCalledWith(0, 'quantity', '2');
  });
});

describe('StepItems — footer', () => {
  it('sums rows and pieces', () => {
    renderStep([{ ...iphone16pro, quantity: '2' }, { ...caseItem, quantity: '10' }], { subtotal: 87300 });
    expect(screen.getByText(/รวม 2 รายการ · 12 ชิ้น/)).toBeInTheDocument();
    expect(screen.getByText('87,300.00 บาท')).toBeInTheDocument();
  });
});
