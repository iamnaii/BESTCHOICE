import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { ContactCombobox, type ContactPickResult } from '@/components/contacts/ContactCombobox';
import { formatDateShort } from '@/utils/formatters';
import { cn } from '@/lib/utils';
import { withOrderDate } from '../../po-dates.util';
import { paymentMethodLabels } from '../../constants';
import type { PoFormState, PurchaseMode, SupplierOption } from '../../types';

interface StepSupplierProps {
  form: PoFormState;
  setForm: React.Dispatch<React.SetStateAction<PoFormState>>;
  mode: PurchaseMode;
  onModeChange: (mode: PurchaseMode) => void;
  suppliersLoading: boolean;
  suppliersError: boolean;
  selectedSupplier: SupplierOption | undefined;
  onSupplierSelect: (result: ContactPickResult) => Promise<void> | void;
  supplierHasVat: boolean;
  creditTermDays: number | null;
  dueDatePreview: Date | null;
  /** From useCreatePoWizard — วันที่คาดรับสินค้าต้องไม่ก่อนวันที่สั่ง */
  expectedDateError: string | null;
  inputClass: string;
}

const MODES: { value: PurchaseMode; label: string; sub: string }[] = [
  { value: 'po', label: 'สั่งซื้อล่วงหน้า (ออก PO)', sub: 'ของยังไม่มา — ออกใบสั่งซื้อ รับของทีหลัง · ผจก.สาขาต้องรอเจ้าของอนุมัติ' },
  { value: 'receive', label: 'ของถึงแล้ว (รับเข้าเลย)', sub: 'ของอยู่ในมือ — ตรวจรับ IMEI/รูป แล้วเข้าคลังทันที ระบบออกเลข PO ให้' },
];

const labelCls = 'block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2';

/**
 * First step of ซื้อสินค้า: who, and which way in. The mode toggle decides whether the wizard
 * asks for order/expected dates (PO) or books the goods today (receive → ตรวจรับ step next).
 */
export function StepSupplier({
  form,
  setForm,
  mode,
  onModeChange,
  suppliersLoading,
  suppliersError,
  selectedSupplier,
  onSupplierSelect,
  supplierHasVat,
  creditTermDays,
  dueDatePreview,
  expectedDateError,
  inputClass,
}: StepSupplierProps) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex items-center justify-center size-8 rounded-lg bg-success/10 text-success">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground leading-snug">ผู้ขาย และวิธีซื้อ</h3>
          <p className="text-xs text-muted-foreground leading-snug">
            ค้นหาจากรายชื่อผู้ติดต่อ หรือสร้างใหม่ได้จากช่องเดียวกัน — แล้วบอกว่าของถึงแล้วหรือยัง
          </p>
        </div>
      </div>

      {/* Which way in — the rows below survive a switch */}
      <div role="radiogroup" aria-label="วิธีซื้อ" className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {MODES.map((m) => {
          const on = mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onModeChange(m.value)}
              className={cn(
                'flex flex-col items-start gap-0.5 rounded-xl border px-3.5 py-2.5 text-left transition-colors',
                on ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-border/60 bg-background hover:bg-muted/40',
              )}
            >
              <span className={cn('flex items-center gap-2 text-sm font-semibold leading-snug', on ? 'text-primary' : 'text-foreground')}>
                <span className={cn('grid size-4 shrink-0 place-items-center rounded-full border-2', on ? 'border-primary bg-primary' : 'border-border bg-background')}>
                  {on && <span className="size-1.5 rounded-full bg-primary-foreground" />}
                </span>
                {m.label}
              </span>
              <span className="pl-6 text-xs leading-snug text-muted-foreground">{m.sub}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr_1fr] lg:items-start">
        <div>
          <label className={labelCls}>
            ผู้ขาย (supplier) <span className="text-destructive">*</span>
          </label>
          <ContactCombobox
            roleNeeded="SUPPLIER"
            value={selectedSupplier?.name ?? (suppliersLoading ? 'กำลังโหลด...' : '')}
            onSelect={onSupplierSelect}
            invalid={!form.supplierId && suppliersError}
            placeholder="เลือก/ค้นหาผู้จัดจำหน่าย"
          />
          <input type="hidden" value={form.supplierId} />
          {selectedSupplier && (
            <div className="mt-1.5 flex gap-2 flex-wrap">
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium leading-snug ${supplierHasVat ? 'bg-primary/10 text-primary dark:bg-primary/15' : 'bg-muted text-muted-foreground'}`}
              >
                {supplierHasVat ? 'ผู้จัดจำหน่ายมี VAT - จะคำนวณ VAT 7% อัตโนมัติ' : 'ผู้จัดจำหน่ายไม่มี VAT'}
              </span>
              {selectedSupplier.paymentMethods?.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium leading-snug bg-primary/10 text-primary">
                  ชำระ: {selectedSupplier.paymentMethods.map((pm) => paymentMethodLabels[pm.paymentMethod] || pm.paymentMethod).join(', ')}
                </span>
              )}
            </div>
          )}
        </div>

        {mode === 'po' ? (
          <>
            <div>
              <label className={labelCls}>
                วันที่สั่ง <span className="text-destructive">*</span>
              </label>
              <ThaiDateInput
                value={form.orderDate}
                onChange={(e) => setForm(withOrderDate(form, e.target.value))}
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className={labelCls}>วันที่คาดรับสินค้า</label>
              <ThaiDateInput
                value={form.expectedDate}
                onChange={(e) => setForm({ ...form, expectedDate: e.target.value })}
                min={form.orderDate || undefined}
                aria-invalid={expectedDateError ? true : undefined}
                className={cn(inputClass, expectedDateError && 'border-destructive focus:ring-destructive/30')}
              />
              {expectedDateError && (
                <p role="alert" className="mt-1 text-xs text-destructive leading-snug">
                  {expectedDateError}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="lg:col-span-2">
            <label className={labelCls}>วันที่รับเข้า</label>
            <p className="flex min-h-10 flex-wrap items-center gap-x-2 text-sm leading-snug text-foreground">
              รับเข้าวันนี้ {form.orderDate ? formatDateShort(form.orderDate) : '-'}
              <span className="text-xs text-muted-foreground">— ระบบตั้งให้ ไม่ต้องกรอกวันคาดรับ</span>
            </p>
          </div>
        )}
      </div>

      {/* Due-date preview (credit-term driven) */}
      {selectedSupplier && (
        <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-sm leading-snug">
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
  );
}
