import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { ExpenseFormState } from './types';

interface Props {
  state: ExpenseFormState;
  onChange: (patch: Partial<ExpenseFormState>) => void;
}

export function VendorSection({ state, onChange }: Props) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div>
        <label className="block text-xs font-medium mb-1">ผู้ขาย <span className="text-destructive">*</span></label>
        <input
          type="text"
          value={state.vendorName}
          onChange={(e) => onChange({ vendorName: e.target.value })}
          placeholder="ชื่อผู้ขาย"
          className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
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
  );
}
