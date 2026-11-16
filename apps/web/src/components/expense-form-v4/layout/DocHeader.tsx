import { useId } from 'react';
import { formControlClass, formLabelClass } from '@/components/ui/form-styles';
import { ReadOnlyField } from '@/components/ui/readonly-field';
import type { DocType } from '../types';
import { DocTypeMenu } from './DocTypeMenu';

interface Props {
  docType: DocType;
  onDocTypeChange: (t: DocType) => void;
  pettyCashEnabled: boolean;
  payrollEnabled: boolean;
  typeLocked: boolean;
  statusLabel: string;
  branchName?: string;
  /** ไม่ส่ง = เอกสารใหม่ (server ออกเลขตอนบันทึก) */
  documentNumber?: string;
  /** ส่งเฉพาะประเภทที่มีช่องเลขใบกำกับ (รายจ่าย, ใบลดหนี้) */
  taxInvoice?: { value: string; onChange: (value: string) => void };
}

export function DocHeader({
  docType, onDocTypeChange, pettyCashEnabled, payrollEnabled, typeLocked,
  statusLabel, branchName, documentNumber, taxInvoice,
}: Props) {
  const fieldId = useId();
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 py-5">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <DocTypeMenu
            value={docType}
            onChange={onDocTypeChange}
            pettyCashEnabled={pettyCashEnabled}
            payrollEnabled={payrollEnabled}
            locked={typeLocked}
          />
          <span className="shrink-0 rounded bg-muted px-2 py-1 text-xs leading-snug text-muted-foreground">
            {statusLabel}
          </span>
        </div>
        {branchName && <p className="text-sm leading-snug text-muted-foreground">สาขา: {branchName}</p>}
      </div>
      <div className="grid w-full grid-cols-1 gap-3 sm:w-auto sm:grid-cols-2">
        {taxInvoice && (
          <div>
            <label htmlFor={`${fieldId}-inv`} className={formLabelClass}>เลขใบกำกับ</label>
            <input
              id={`${fieldId}-inv`}
              type="text"
              value={taxInvoice.value}
              onChange={(e) => taxInvoice.onChange(e.target.value)}
              placeholder="INV-..."
              className={formControlClass}
            />
          </div>
        )}
        <div>
          <label htmlFor={`${fieldId}-no`} className={formLabelClass}>เลขที่เอกสาร</label>
          <ReadOnlyField id={`${fieldId}-no`} value={documentNumber ?? 'ออกเลขเมื่อบันทึก'} />
        </div>
      </div>
    </div>
  );
}
