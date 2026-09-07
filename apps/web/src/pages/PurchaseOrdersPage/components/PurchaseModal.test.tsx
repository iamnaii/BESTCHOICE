import { describe, it, expect, vi } from 'vitest';
import { useEffect } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PurchaseModal } from './PurchaseModal';
import { usePOForm } from '../hooks/usePOForm';
import { useCreatePoWizard } from '../hooks/useCreatePoWizard';
import { computePoTotals } from '../poTotals';
import type { ItemForm, SupplierOption } from '../types';

vi.mock('@/components/contacts/ContactCombobox', () => ({
  ContactCombobox: ({ value, placeholder, onSelect }: { value: string; placeholder?: string; onSelect: (r: { childId: string }) => void }) => (
    <button type="button" role="combobox" aria-label="ผู้ขาย" onClick={() => onSelect({ childId: 's1' })}>
      {value || placeholder}
    </button>
  ),
}));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const blank: ItemForm = { brand: '', category: '', model: '', color: '', storage: '', quantity: '1', unitPrice: '', accessoryType: '', accessoryBrand: '' };
const phone: ItemForm = { ...blank, brand: 'Apple', category: 'PHONE_NEW', model: 'iPhone 17 Pro', color: 'Deep Blue', storage: '256GB', quantity: '1', unitPrice: '42900' };
const film: ItemForm = { ...blank, category: 'ACCESSORY', accessoryType: 'F1601', accessoryBrand: 'iStar', model: 'ฟิล์มกระจก iPhone 16 - iStar', quantity: '1', unitPrice: '35', sourceName: 'ฟิล์มกระจก iPhone 16 - iStar', sourceCode: 'F1601', sourceInStock: 13 };
const supplier: SupplierOption = { id: 's1', name: 'ขนิษฐา คล้ายมณี', contactName: null, hasVat: false, paymentMethods: [{ paymentMethod: 'CASH', isDefault: true }] };

type Mut = { isPending: boolean; mutate: ReturnType<typeof vi.fn> };
function Harness({ initialItems, createMutation, directReceiveMutation, onClose = vi.fn() }: { initialItems: ItemForm[]; createMutation: Mut; directReceiveMutation: Mut; onClose?: () => void }) {
  const poForm = usePOForm({ createMutation: createMutation as never, suppliers: [supplier] });
  const wizard = useCreatePoWizard({ isOpen: true, form: poForm.form, setForm: poForm.setForm, items: poForm.items, setItems: poForm.setItems, selectedSupplier: poForm.selectedSupplier });
  const { setItems } = poForm;
  useEffect(() => { setItems(initialItems); }, [initialItems, setItems]);
  const totals = computePoTotals({ items: poForm.items, discount: poForm.form.discount, discountAfterVat: poForm.form.discountAfterVat, supplierHasVat: poForm.supplierHasVat });
  return (
    <PurchaseModal
      isOpen
      onClose={onClose}
      form={poForm.form}
      setForm={poForm.setForm}
      items={poForm.items}
      removeItem={poForm.removeItem}
      duplicateItem={poForm.duplicateItem}
      updateItem={poForm.updateItem}
      toggleModel={poForm.toggleModel}
      addCatalogItem={poForm.addCatalogItem}
      addAccessoryItem={poForm.addAccessoryItem}
      addExistingAccessoryItem={poForm.addExistingAccessoryItem}
      searchAccessorySkus={vi.fn().mockResolvedValue([])}
      suppliers={[supplier]}
      suppliersLoading={false}
      suppliersError={false}
      selectedSupplier={poForm.selectedSupplier}
      onSupplierSelect={async ({ childId }) => poForm.setForm((f) => ({ ...f, supplierId: childId }))}
      supplierHasVat={poForm.supplierHasVat}
      subtotal={poForm.subtotal}
      createMutation={createMutation as never}
      handleCreate={poForm.handleCreate}
      attachmentUrl={poForm.attachmentUrl}
      setAttachmentUrl={poForm.setAttachmentUrl}
      formAttachments={poForm.formAttachments}
      setFormAttachments={poForm.setFormAttachments}
      wizard={wizard}
      totals={totals}
      directReceiveMutation={directReceiveMutation as never}
    />
  );
}

function renderModal(initialItems: ItemForm[] = [phone, film]) {
  localStorage.clear();
  const createMutation: Mut = { isPending: false, mutate: vi.fn() };
  const directReceiveMutation: Mut = { isPending: false, mutate: vi.fn() };
  render(<Harness initialItems={initialItems} createMutation={createMutation} directReceiveMutation={directReceiveMutation} />);
  return { createMutation, directReceiveMutation };
}
const dialog = () => screen.getByRole('dialog', { name: 'ซื้อสินค้า' });
const stepLabels = () => within(dialog()).getAllByRole('listitem').map((li) => li.textContent?.trim());
const pickSupplier = () => fireEvent.click(screen.getByRole('combobox', { name: 'ผู้ขาย' }));

describe('PurchaseModal — one entry "ซื้อสินค้า" for both สั่งซื้อล่วงหน้า and ของถึงแล้ว (owner 2026-09-06)', () => {
  it('opens in PO mode: supplier + items on one step, dates shown, two steps, locked until a supplier is picked', () => {
    renderModal();
    expect(screen.getByRole('heading', { name: 'ซื้อสินค้า' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /สั่งซื้อล่วงหน้า/ })).toHaveAttribute('aria-checked', 'true');
    expect(stepLabels()).toEqual(['ผู้ขาย + รายการ', 'สรุป + จ่ายเงิน']);
    expect(screen.getByText('วันที่สั่ง', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'ราคา/ชิ้น' })).toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'ถัดไป: สรุป + จ่ายเงิน' });
    expect(next).toBeDisabled();
    expect(screen.getByText('เลือกผู้ขายก่อน')).toBeInTheDocument();
    pickSupplier();
    expect(screen.getByRole('button', { name: 'ถัดไป: สรุป + จ่ายเงิน' })).toBeEnabled();
    expect(document.querySelector('button[type="submit"]')).toBeNull();
  });

  it('PO mode: ถัดไป → summary → สร้าง PO submits through handleCreate', () => {
    const { createMutation, directReceiveMutation } = renderModal();
    pickSupplier();
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป: สรุป + จ่ายเงิน' }));
    expect(screen.getByRole('region', { name: 'สรุปใบสั่งซื้อ' })).toHaveTextContent('สั่ง');
    const create = screen.getByRole('button', { name: 'สร้าง PO' });
    expect(create).toHaveAttribute('type', 'button');
    fireEvent.click(create);
    expect(createMutation.mutate).toHaveBeenCalledWith(expect.objectContaining({ supplierId: 's1', items: expect.arrayContaining([expect.objectContaining({ model: 'iPhone 17 Pro', unitPrice: 42900 })]) }));
    expect(directReceiveMutation.mutate).not.toHaveBeenCalled();
  });

  it('switching to ของถึงแล้ว hides the dates, relabels to cost, adds ตรวจรับ and counts the pieces to inspect', () => {
    renderModal();
    pickSupplier();
    fireEvent.click(screen.getByRole('radio', { name: /ของถึงแล้ว/ }));
    expect(screen.getByRole('radio', { name: /ของถึงแล้ว/ })).toHaveAttribute('aria-checked', 'true');
    expect(stepLabels()).toEqual(['ผู้ขาย + รายการ', 'ตรวจรับ', 'สรุป + จ่ายเงิน']);
    expect(screen.queryByText('วันที่คาดรับสินค้า')).toBeNull();
    expect(screen.getByText(/รับเข้าวันนี้/)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'ราคาทุน/ชิ้น' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ถัดไป: ตรวจรับ 2 ชิ้น' })).toBeEnabled();
    // the rows survive the switch
    expect(screen.getByRole('row', { name: /รายการ #1: iPhone 17 Pro/ })).toBeInTheDocument();
  });

  it('receive mode: ตรวจรับ → สรุป + จ่ายเงิน → ยืนยันรับเข้าตรง sends the units with the payment', () => {
    const { createMutation, directReceiveMutation } = renderModal();
    pickSupplier();
    fireEvent.click(screen.getByRole('radio', { name: /ของถึงแล้ว/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป: ตรวจรับ 2 ชิ้น' }));
    expect(screen.getByRole('heading', { name: 'ซื้อสินค้า — ตรวจรับ' })).toBeInTheDocument();
    // one device per screen: a phone screen + one counted accessory line
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByText('เครื่องที่ 1 จาก 2')).toBeInTheDocument();
    expect(screen.getByText('42,900 บาท')).toBeInTheDocument(); // the row's cost, read-only
    fireEvent.change(screen.getByLabelText(/^IMEI/), { target: { value: '356000000090601' } });
    fireEvent.change(screen.getByLabelText(/^หมายเลขซีเรียล/), { target: { value: 'QASN0906A' } });
    fireEvent.click(screen.getByRole('button', { name: 'ผ่าน' }));
    fireEvent.change(screen.getByLabelText(/^ราคาเงินสด/), { target: { value: '45900' } });
    fireEvent.change(screen.getByLabelText(/^ราคาผ่อน/), { target: { value: '49900' } });
    fireEvent.click(screen.getByRole('button', { name: 'ไปเครื่องถัดไป' }));
    expect(screen.getByText('ชิ้นที่ 2 จาก 2')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^ราคาเงินสด/), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป: สรุป + จ่ายเงิน' }));
    expect(screen.getByRole('heading', { name: 'ซื้อสินค้า — สรุป + จ่ายเงิน' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'สรุปใบสั่งซื้อ' })).toHaveTextContent('รับเข้าวันนี้');
    fireEvent.change(screen.getByRole('combobox', { name: 'สถานะการจ่าย' }), { target: { value: 'FULLY_PAID' } });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันรับเข้าตรง 2 ชิ้น' }));
    expect(directReceiveMutation.mutate).toHaveBeenCalledWith(expect.objectContaining({
      supplierId: 's1', paymentStatus: 'FULLY_PAID', paymentMethod: 'CASH', paidAmount: 42935,
      items: expect.arrayContaining([
        expect.objectContaining({ imeiSerial: '356000000090601', serialNumber: 'QASN0906A', status: 'PASS', sellingPrice: '45900', installmentPrice: '49900' }),
        expect.objectContaining({ category: 'ACCESSORY', status: 'PASS', sellingPrice: '150' }),
      ]),
    }));
    expect(createMutation.mutate).not.toHaveBeenCalled();
    expect(document.querySelector('button[type="submit"]')).toBeNull();
  });

  it('receive mode: ตรวจรับ refuses to move on while a phone is still undecided', () => {
    const { directReceiveMutation } = renderModal([phone]);
    pickSupplier();
    fireEvent.click(screen.getByRole('radio', { name: /ของถึงแล้ว/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป: ตรวจรับ 1 ชิ้น' }));
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป: สรุป + จ่ายเงิน' }));
    expect(screen.getByRole('heading', { name: 'ซื้อสินค้า — ตรวจรับ' })).toBeInTheDocument();
    expect(directReceiveMutation.mutate).not.toHaveBeenCalled();
  });
});
