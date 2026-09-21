import { useEffect, useId, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  MAX_REFERENCE_LENGTH,
  MAX_TENDERS,
  MIN_REFERENCE_LENGTH,
  TENDER_METHOD_OPTIONS,
  TenderMethod,
  TenderRow,
  formatBaht,
  fromSatang,
  initialTenders,
  needsReference,
  referenceOk,
  tenderStatus,
  toSatang,
  toTenderPayload,
} from './tender-utils';

const fieldClass =
  'w-full h-11 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20 disabled:opacity-60';
const labelClass = 'block text-xs text-muted-foreground mb-1 leading-snug';

/**
 * สถานะของช่องรับเงินสำหรับหน้าที่ใช้ — บรรทัดเดียว = ยอดตามยอดที่ต้องรับเสมอ (ผู้ใช้ไม่ต้องพิมพ์)
 * หลายบรรทัด = ผู้ใช้กำหนดเอง และปุ่มบันทึกเปิดเมื่อยอดรวมเท่ายอดที่ต้องรับพอดี.
 */
export function useTenders(due: number) {
  const [rows, setRows] = useState<TenderRow[]>(() => initialTenders(due));
  useEffect(() => {
    setRows((prev) => (prev.length === 1 ? [{ ...prev[0], amount: fromSatang(Math.max(0, toSatang(due))) }] : prev));
  }, [due]);
  return {
    rows,
    setRows,
    status: tenderStatus(rows, due),
    payload: toTenderPayload(rows, due),
    reset: () => setRows(initialTenders(due)),
  };
}

interface TenderInputProps {
  /** ยอดเงินจริงที่ต้องรับ (ไม่นับเครดิตเครื่องเทิร์น / มัดจำที่รับไปแล้ว) */
  due: number;
  value: TenderRow[];
  onChange: (rows: TenderRow[]) => void;
  /** ข้อความหัวช่อง เช่น "ยอดที่ต้องรับ" / "เงินดาวน์ที่ต้องรับ" */
  dueLabel?: string;
  disabled?: boolean;
  /** แสดงตัวช่วยคิดเงินทอนเมื่อรับเงินสดบรรทัดเดียว (ค่าเริ่มต้น: แสดง) */
  showChangeHelper?: boolean;
}

/** ช่องรับเงินกลาง (mockup กระดาน 4/6) — ใช้ที่ POS · ทำสัญญา · ใบจอง */
export function TenderInput({ due, value, onChange, dueLabel = 'ยอดที่ต้องรับ', disabled, showChangeHelper = true }: TenderInputProps) {
  const uid = useId();
  const [handed, setHanded] = useState('');
  const status = tenderStatus(value, due);
  const single = value.length === 1;

  if (status.dueSatang === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground leading-snug" data-testid="tender-none">
        ไม่มียอดที่ต้องรับ
      </div>
    );
  }

  const update = (index: number, patch: Partial<TenderRow>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const addRow = () => {
    const remaining = Math.max(0, status.dueSatang - value.reduce((sum, r) => sum + toSatang(r.amount), 0));
    // บรรทัดเดียวถือยอดเต็มอยู่ → แบ่งครึ่งไม่ได้เดาให้: ล้างยอดบรรทัดแรกให้ผู้ใช้กรอก แล้วบรรทัดใหม่รับส่วนที่เหลือ
    const base = single ? [{ ...value[0], amount: '' }] : value;
    onChange([...base, { method: 'BANK_TRANSFER', amount: single ? '' : fromSatang(remaining), reference: '' }]);
  };

  const removeRow = (index: number) => {
    const next = value.filter((_, i) => i !== index);
    onChange(next.length === 1 ? [{ ...next[0], amount: fromSatang(status.dueSatang) }] : next);
  };

  /** พอผู้ใช้กรอกยอดบรรทัดแรกของบิล 2 บรรทัด → ใส่ส่วนที่เหลือให้บรรทัดที่สองเอง (ตาม mockup) */
  const onAmountChange = (index: number, amount: string) => {
    if (value.length === 2 && index === 0 && value[1].amount === '') {
      const rest = Math.max(0, status.dueSatang - toSatang(amount));
      onChange([{ ...value[0], amount }, { ...value[1], amount: rest > 0 ? fromSatang(rest) : '' }]);
      return;
    }
    update(index, { amount });
  };

  const change = toSatang(handed) - status.dueSatang;
  const statusTone = status.ready ? 'text-success' : 'text-destructive';

  return (
    <div className="space-y-3" data-testid="tender-input">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground leading-snug">{dueLabel}</span>
        <span className="text-lg font-bold text-foreground">{formatBaht(status.dueSatang)} ฿</span>
      </div>

      {value.map((row, index) => {
        const methodId = `${uid}-method-${index}`;
        const amountId = `${uid}-amount-${index}`;
        const refId = `${uid}-ref-${index}`;
        const refBad = needsReference(row.method) && row.reference.trim().length > 0 && !referenceOk(row);
        return (
          <div key={index} className={single ? 'space-y-2' : 'rounded-lg border border-border p-3 space-y-2'}>
            {!single && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground leading-snug">วิธีที่ {index + 1}</span>
                <button type="button" onClick={() => removeRow(index)} disabled={disabled}
                  className="min-h-11 px-2 text-sm text-destructive hover:underline disabled:opacity-60">
                  นำออก
                </button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={methodId} className={labelClass}>วิธีรับเงิน{single ? '' : ` วิธีที่ ${index + 1}`}</label>
                <select id={methodId} value={row.method} disabled={disabled} className={fieldClass}
                  onChange={(e) => update(index, { method: e.target.value as TenderMethod, reference: e.target.value === 'CASH' ? '' : row.reference })}>
                  {TENDER_METHOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={amountId} className={labelClass}>จำนวนเงิน{single ? '' : ` วิธีที่ ${index + 1}`}</label>
                <input id={amountId} type="number" inputMode="decimal" min="0" step="0.01" value={row.amount}
                  // บรรทัดเดียว = ยอดเต็มเสมอ ไม่ให้แก้ (แก้ได้เมื่อแบ่งจ่ายหลายวิธี)
                  readOnly={single} disabled={disabled} className={`${fieldClass} text-right ${single ? 'bg-muted/40' : ''}`}
                  onChange={(e) => onAmountChange(index, e.target.value)} />
              </div>
            </div>
            {needsReference(row.method) && (
              <div>
                <label htmlFor={refId} className={labelClass}>
                  เลขอ้างอิงการโอน{single ? '' : ` วิธีที่ ${index + 1}`} <span className="text-destructive">*</span>
                </label>
                <input id={refId} type="text" value={row.reference} maxLength={MAX_REFERENCE_LENGTH} disabled={disabled}
                  placeholder="ดูจากสลิปของลูกค้า" aria-invalid={refBad}
                  className={`${fieldClass} ${refBad ? 'border-destructive' : ''}`}
                  onChange={(e) => update(index, { reference: e.target.value })} />
                <p className={`mt-1 text-xs leading-snug ${refBad ? 'text-destructive' : 'text-muted-foreground'}`}>
                  กรอกเลขอ้างอิงจากสลิปก่อนบันทึก (อย่างน้อย {MIN_REFERENCE_LENGTH} ตัว)
                </p>
              </div>
            )}
          </div>
        );
      })}

      {showChangeHelper && single && value[0].method === 'CASH' && (
        <div className="grid grid-cols-2 gap-3 items-end rounded-lg bg-muted/40 p-3">
          <div>
            <label htmlFor={`${uid}-handed`} className={labelClass}>ลูกค้ายื่นเงินมา</label>
            <input id={`${uid}-handed`} type="number" inputMode="decimal" min="0" value={handed} disabled={disabled}
              className={`${fieldClass} text-right`} onChange={(e) => setHanded(e.target.value)} />
          </div>
          <div className="pb-1">
            <div className="text-xs text-muted-foreground leading-snug">เงินทอน</div>
            <div className={`text-base font-semibold ${handed && change < 0 ? 'text-destructive' : 'text-foreground'}`}>
              {handed ? `${formatBaht(change)} ฿` : '—'}
            </div>
          </div>
        </div>
      )}

      {value.length < MAX_TENDERS && (
        <button type="button" onClick={addRow} disabled={disabled}
          className="w-full min-h-11 rounded-lg border border-dashed border-input text-sm font-semibold text-primary hover:bg-accent disabled:opacity-60 inline-flex items-center justify-center gap-1.5">
          <Plus className="size-4" aria-hidden />
          {single ? 'เพิ่มวิธีรับเงิน (ลูกค้าจ่ายผสม)' : 'เพิ่มวิธีรับเงิน'}
        </button>
      )}

      <div className="flex items-center justify-between border-t border-border pt-3 text-sm" role="status">
        <span className={`font-semibold leading-snug ${statusTone}`}>{status.label}</span>
        <span className="font-semibold text-foreground">{formatBaht(status.totalSatang)} / {formatBaht(status.dueSatang)}</span>
      </div>
    </div>
  );
}
