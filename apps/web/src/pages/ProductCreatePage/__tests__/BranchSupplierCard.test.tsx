import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { openCombobox, pickComboOption } from '@/test/combobox';
import BranchSupplierCard from '../components/BranchSupplierCard';

const suppliers = [
  { id: 'sup-1', name: 'บริษัท มือถือดี จำกัด' },
  { id: 'sup-2', name: 'ห้างหุ้นส่วน ไอโฟนไทย' },
];

function renderCard(over: Partial<React.ComponentProps<typeof BranchSupplierCard>> = {}) {
  const props: React.ComponentProps<typeof BranchSupplierCard> = {
    branchId: '',
    supplierId: '',
    costPrice: '',
    branchList: [{ id: 'branch-1', name: 'สาขาหลัก' }],
    suppliers,
    suppliersLoading: false,
    suppliersError: false,
    onRetrySuppliers: vi.fn(),
    inputCls: '',
    onChange: vi.fn(),
    ...over,
  };
  render(<BranchSupplierCard {...props} />);
  return props;
}

describe('BranchSupplierCard — ผู้จัดจำหน่าย (Combobox)', () => {
  it('shows ไม่ระบุ when none is chosen and sends the picked supplier id', async () => {
    const user = userEvent.setup();
    const p = renderCard();
    expect(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' })).toHaveTextContent(/^ไม่ระบุ$/);
    await pickComboOption(user, 'ผู้จัดจำหน่าย', 'ห้างหุ้นส่วน ไอโฟนไทย', { search: 'ไอโฟน' });
    expect(p.onChange).toHaveBeenCalledWith('supplierId', 'sup-2');
  });

  it('ไม่ระบุ clears a chosen supplier', async () => {
    const user = userEvent.setup();
    const p = renderCard({ supplierId: 'sup-1' });
    expect(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' })).toHaveTextContent('บริษัท มือถือดี จำกัด');
    await pickComboOption(user, 'ผู้จัดจำหน่าย', 'ไม่ระบุ');
    expect(p.onChange).toHaveBeenCalledWith('supplierId', '');
  });

  it('while suppliers load the list says กำลังโหลด…', async () => {
    const user = userEvent.setup();
    renderCard({ suppliers: [], suppliersLoading: true });
    await openCombobox(user, 'ผู้จัดจำหน่าย');
    expect(screen.getByText('กำลังโหลด…')).toBeInTheDocument();
  });

  it('when suppliers fail the list says โหลดรายการไม่สำเร็จ and ลองใหม่ refetches', async () => {
    const user = userEvent.setup();
    const p = renderCard({ suppliers: [], suppliersError: true });
    await openCombobox(user, 'ผู้จัดจำหน่าย');
    expect(screen.getByText('โหลดรายการไม่สำเร็จ')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(p.onRetrySuppliers).toHaveBeenCalledTimes(1);
    expect(p.onChange).not.toHaveBeenCalled();
  });
});
