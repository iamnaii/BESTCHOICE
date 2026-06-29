import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { ContactCombobox } from '@/components/contacts/ContactCombobox';
import { formatDateShort } from '@/utils/formatters';
import type { CreatePOModalProps } from '../CreatePOModal';

interface StepSupplierProps {
  form: CreatePOModalProps['form'];
  setForm: CreatePOModalProps['setForm'];
  suppliersLoading: boolean;
  suppliersError: boolean;
  selectedSupplier: CreatePOModalProps['selectedSupplier'];
  onSupplierSelect: CreatePOModalProps['onSupplierSelect'];
  supplierHasVat: boolean;
  creditTermDays: number | null;
  dueDatePreview: Date | null;
  inputClass: string;
}

export function StepSupplier({
  form, setForm, suppliersLoading, suppliersError, selectedSupplier,
  onSupplierSelect, supplierHasVat, creditTermDays, dueDatePreview, inputClass,
}: StepSupplierProps) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex items-center justify-center size-8 rounded-lg bg-success/10 text-success">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground leading-snug">ข้อมูลผู้จัดจำหน่าย</h3>
          <p className="text-xs text-muted-foreground leading-snug">เลือกผู้จัดจำหน่ายและวันที่สั่งซื้อ</p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ผู้จัดจำหน่าย <span className="text-destructive">*</span></label>
          <ContactCombobox
            roleNeeded="SUPPLIER"
            value={selectedSupplier?.name ?? (suppliersLoading ? 'กำลังโหลด...' : '')}
            onSelect={onSupplierSelect}
            invalid={!form.supplierId && suppliersError}
            placeholder="เลือก/ค้นหาผู้จัดจำหน่าย"
          />
          <input type="hidden" value={form.supplierId} />
          {selectedSupplier && (
            <div className="mt-1 flex gap-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium leading-snug ${supplierHasVat ? 'bg-primary/10 text-primary dark:bg-primary/15' : 'bg-muted text-muted-foreground'}`}>
                {supplierHasVat ? 'ผู้จัดจำหน่ายมี VAT - จะคำนวณ VAT 7% อัตโนมัติ' : 'ผู้จัดจำหน่ายไม่มี VAT'}
              </span>
              {selectedSupplier.paymentMethods?.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium leading-snug bg-primary/10 text-primary">
                  ชำระ: {selectedSupplier.paymentMethods.map((pm) => {
                    const labels: Record<string, string> = { CASH: 'เงินสด', BANK_TRANSFER: 'โอนธนาคาร', CHECK: 'เช็ค', CREDIT: 'เครดิต' };
                    return labels[pm.paymentMethod] || pm.paymentMethod;
                  }).join(', ')}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">วันที่สั่ง <span className="text-destructive">*</span></label>
            <ThaiDateInput value={form.orderDate} onChange={(e) => setForm({ ...form, orderDate: e.target.value })} className={inputClass} required />
          </div>
          <div>
            <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">วันที่คาดรับสินค้า</label>
            <ThaiDateInput value={form.expectedDate} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} className={inputClass} />
          </div>
        </div>

        {/* Due-date preview (credit-term driven) */}
        {selectedSupplier && (
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm leading-snug">
            {creditTermDays && dueDatePreview ? (
              <span className="text-foreground">
                เครดิต <span className="font-semibold">{creditTermDays}</span> วัน → ครบกำหนดชำระ{' '}
                <span className="font-semibold text-primary">{formatDateShort(dueDatePreview)}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">ไม่มีเครดิต (ชำระทันที) — ไม่มีวันครบกำหนด</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
