import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { ExpenseFormState } from './types';
import TaxDisallowedHint from './TaxDisallowedHint';
import { VendorCombobox } from './VendorCombobox';

interface Props {
  state: ExpenseFormState;
  onChange: (patch: Partial<ExpenseFormState>) => void;
}

export function VendorSection({ state, onChange }: Props) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1">ผู้ขาย <span className="text-destructive">*</span></label>
          <VendorCombobox
            value={state.vendorName}
            onSelectSupplier={(s) =>
              onChange({
                vendorName: s.name,
                vendorTaxId: s.taxId,
                ...(s.whtFormType ? { whtFormType: s.whtFormType } : {}),
              })
            }
            onTypeName={(name) => onChange({ vendorName: name })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">ประเภทผู้ขาย</label>
          <select
            value={state.whtFormType}
            onChange={(e) => onChange({ whtFormType: e.target.value as 'PND3' | 'PND53' | '' })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
          >
            <option value="">— เลือก —</option>
            <option value="PND53">นิติบุคคล (ภงด.53)</option>
            <option value="PND3">บุคคลธรรมดา (ภงด.3)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">เลขประจำตัวผู้เสียภาษี</label>
          <input
            type="text"
            value={state.vendorTaxId}
            onChange={(e) => onChange({ vendorTaxId: e.target.value })}
            placeholder="13 หลัก"
            maxLength={13}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">เลขใบกำกับ</label>
          <input
            type="text"
            value={state.taxInvoiceNo}
            onChange={(e) => onChange({ taxInvoiceNo: e.target.value })}
            placeholder="INV-..."
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">วันที่ใบกำกับ <span className="text-destructive">*</span></label>
          <ThaiDateInput
            value={state.documentDate}
            onChange={(e) => onChange({ documentDate: e.target.value })}
            required
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">ประเภทราคา</label>
          <select
            value={state.priceType}
            onChange={(e) => onChange({ priceType: e.target.value as 'EXCLUSIVE' | 'INCLUSIVE' })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
          >
            <option value="EXCLUSIVE">ไม่รวม VAT</option>
            <option value="INCLUSIVE">รวม VAT</option>
          </select>
        </div>
      </div>

      {/* Phase A.5 — Tax-disallowed flag (ม.65 ตรี ป.รัษฎากร).
          Bookkeeping unchanged — flag only affects ภ.ง.ด.50/51 deductible total
          at year-end. Display as a single doc-level checkbox; per-line override
          lives on each line row for the rare mixed-category case.
          Owner B2 (2026-05-17): TaxDisallowedHint exposes the full ม.65 ตรี
          category list via a Popover next to the inline description. */}
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={state.taxDisallowed}
            onChange={(e) => onChange({ taxDisallowed: e.target.checked })}
            className="mt-0.5"
          />
          <div className="text-xs leading-snug">
            <div className="font-medium">ค่าใช้จ่ายต้องห้าม (ม.65 ตรี ป.รัษฎากร)</div>
            <div className="text-muted-foreground mt-0.5">
              ติ๊กเมื่อเป็นค่าใช้จ่ายที่หักลดหย่อนภาษีนิติบุคคลไม่ได้ (เช่น ค่ารับรองเกิน 2,000 บาท, ค่าปรับสรรพากร, รายจ่ายส่วนตัว). บันทึกบัญชีปกติ — มีผลเฉพาะรายงาน ภ.ง.ด.50/51
            </div>
          </div>
        </label>
        <div className="mt-1.5 pl-6">
          <TaxDisallowedHint />
        </div>
      </div>
    </div>
  );
}
