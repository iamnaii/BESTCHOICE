import { NumberInput } from '@/components/ui/NumberInput';
import { NativeSelect } from '@/components/ui/native-select';
import { Combobox } from '@/components/ui/combobox';
import { useId as useFieldId, type ReactNode } from 'react';
import FormSection from './FormSection';

interface BranchSupplierCardProps {
  number?: number;
  /** ช่องเพิ่มท้ายกริด (หน้าเพิ่มสินค้า: สถานะ) */
  children?: ReactNode;
  branchId: string;
  supplierId: string;
  costPrice: string;
  branchList: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  suppliersLoading: boolean;
  suppliersError: boolean;
  /** Refetch the supplier list (the field's "ลองใหม่" button). */
  onRetrySuppliers: () => void;
  inputCls: string;
  onChange: (field: string, value: string) => void;
}

export default function BranchSupplierCard({
  number,
  children,
  branchId,
  supplierId,
  costPrice,
  branchList,
  suppliers,
  suppliersLoading,
  suppliersError,
  onRetrySuppliers,
  inputCls,
  onChange,
}: BranchSupplierCardProps) {
  const fieldId = useFieldId();
  return (
    <FormSection number={number} title="รับเข้าคลัง" subtitle="สาขา ผู้จัดจำหน่าย ราคาทุน และสถานะ">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label
            htmlFor={`${fieldId}-1`}
            className="block text-sm font-medium text-foreground mb-3"
          >
            สาขา *
          </label>
          <NativeSelect
            id={`${fieldId}-1`}
            value={branchId}
            onChange={(e) => onChange('branchId', e.target.value)}
            className={inputCls}
            required
          >
            <option value="">เลือกสาขา</option>
            {branchList.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label
            htmlFor={`${fieldId}-2`}
            className="block text-sm font-medium text-foreground mb-3"
          >
            ผู้จัดจำหน่าย
          </label>
          <Combobox
            id={`${fieldId}-2`}
            value={supplierId}
            onChange={(value) => onChange('supplierId', value)}
            options={[
              { value: '', label: 'ไม่ระบุ' },
              ...suppliers.map((s) => ({ value: s.id, label: s.name })),
            ]}
            loading={suppliersLoading}
            error={suppliersError}
            onRetry={onRetrySuppliers}
          />
        </div>
        <div>
          <label
            htmlFor={`${fieldId}-3`}
            className="block text-sm font-medium text-foreground mb-3"
          >
            ราคาทุน (บาท) *
          </label>
          <NumberInput
            unstyled
            id={`${fieldId}-3`}
            step="0.01"
            value={costPrice}
            onChange={(e) => onChange('costPrice', e.target.value)}
            className={inputCls}
            required
          />
        </div>
        {children}
      </div>
    </FormSection>
  );
}
