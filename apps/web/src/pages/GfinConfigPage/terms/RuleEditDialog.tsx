import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TriangleAlert, X } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/NumberInput';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { GfinTables } from '@/pages/ProductDetailPage/utils/gfinQuote';
import { GFIN_QUERY_KEYS } from '@/pages/ProductDetailPage/hooks/gfinQueryKeys';
import { HAND_LABEL, type ModelTermsRow } from './modelTerms';
import {
  MONTH_CHOICES,
  describeEdit,
  needsValues,
  previewExample,
  summarizeCurrent,
  toBulkUpsertBody,
  validateEdit,
  type RuleEdit,
} from './ruleChange';

/** bulk-upsert ฝั่งเซิร์ฟเวอร์รับไม่เกิน 200 รายการต่อคำขอ */
const MAX_ROWS = 200;

const fmt = (n: number) => n.toLocaleString('th-TH');

interface Props {
  rows: ModelTermsRow[];
  tables: GfinTables;
  onRemove: (key: string) => void;
  onClose: () => void;
  /** เรียกเมื่อบันทึกสำเร็จ (ก่อน onClose) — ยกเลิก/ปิดกล่องไม่เรียก */
  onSaved?: () => void;
}

/** กล่องแก้เงื่อนไข 1 แถวหรือหลายแถว (สเปก §6.2 ข้อ 5) — บันทึกทั้งชุดในคำขอเดียว */
export function RuleEditDialog({ rows, tables, onRemove, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const required = needsValues(rows);
  const [allowanceMode, setAllowanceMode] = useState<'keep' | 'set'>(required ? 'set' : 'keep');
  const [allowanceValue, setAllowanceValue] = useState('');
  const [months, setMonths] = useState<string>('keep');
  const [downMode, setDownMode] = useState<'keep' | 'default' | 'set'>('keep');
  const [downValue, setDownValue] = useState('');

  const edit: RuleEdit = {
    allowance:
      allowanceMode === 'set' && allowanceValue !== ''
        ? { mode: 'set', value: Number(allowanceValue) }
        : { mode: 'keep' },
    maxMonths: months === 'keep' ? { mode: 'keep' } : { mode: 'set', value: Number(months) },
    down:
      downMode === 'default'
        ? { mode: 'default' }
        : downMode === 'set' && downValue !== ''
          ? { mode: 'set', value: Number(downValue) }
          : { mode: 'keep' },
  };
  const error = validateEdit(rows, edit);
  const now = summarizeCurrent(rows);
  const lines = error ? [] : describeEdit(rows, edit, tables.settings.minDownPct);
  const example = error ? null : previewExample(tables, rows, edit);
  const tooMany = rows.length > MAX_ROWS;
  const needAllowance = allowanceMode === 'set' && allowanceValue === '';
  const needDown = downMode === 'set' && downValue === '';
  const hands = [...new Set(rows.map((r) => HAND_LABEL[r.condition]))].join(' และ ');

  const save = useMutation({
    mutationFn: () => api.post('/gfin-config/overprice-rules/bulk-upsert', toBulkUpsertBody(rows, edit)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: GFIN_QUERY_KEYS.rules });
      toast.success(`บันทึกเงื่อนไข ${rows.length} รุ่นแล้ว`);
      onSaved?.();
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            แก้เงื่อนไข{rows.length > 1 ? 'พร้อมกัน' : ''} · {rows.length} รุ่น · {hands}
          </DialogTitle>
          <DialogDescription className="leading-snug">
            ช่องที่เลือก "ไม่เปลี่ยน" แต่ละรุ่นคงค่าเดิมของตัวเอง
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium leading-snug">รุ่นที่จะแก้</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {rows.map((r) => (
                <li key={r.key} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-sm">
                  {r.series} <span className="text-muted-foreground">{HAND_LABEL[r.condition]}</span>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      className="rounded-full p-0.5 hover:bg-accent"
                      aria-label={`เอา ${r.series} ${HAND_LABEL[r.condition]} ออก`}
                      onClick={() => onRemove(r.key)}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium leading-snug">OVER (บวกเพิ่มจากราคาใบ) · ข้อ 7</legend>
            <p className="text-xs text-muted-foreground leading-snug">{now.allowance}</p>
            <RadioGroup value={allowanceMode} onValueChange={(v) => setAllowanceMode(v as 'keep' | 'set')}>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="keep" disabled={required} /> ไม่เปลี่ยน
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="set" /> ตั้งเป็น
                <NumberInput
                  aria-label="OVER (บาท)"
                  className="w-32"
                  min="0"
                  step="0.01"
                  value={allowanceValue}
                  onFocus={() => setAllowanceMode('set')}
                  onChange={(e) => setAllowanceValue(e.target.value)}
                />
                บาท
              </label>
              {needAllowance && (
                <p className="flex items-start gap-1.5 text-xs text-warning-strong leading-snug">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  กรอกตัวเลขก่อนบันทึก
                </p>
              )}
            </RadioGroup>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium leading-snug">ผ่อนสูงสุด · ข้อ 4</legend>
            <p className="text-xs text-muted-foreground leading-snug">{now.maxMonths}</p>
            <RadioGroup value={months} onValueChange={setMonths} className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="keep" disabled={required} /> ไม่เปลี่ยน
              </label>
              {MONTH_CHOICES.map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value={String(m)} /> {m} งวด
                </label>
              ))}
            </RadioGroup>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium leading-snug">เงินดาวน์ขั้นต่ำ · ข้อ 2</legend>
            <p className="text-xs text-muted-foreground leading-snug">{now.down}</p>
            <RadioGroup value={downMode} onValueChange={(v) => setDownMode(v as 'keep' | 'default' | 'set')}>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="keep" /> ไม่เปลี่ยน
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="default" /> ใช้ค่ากลาง · {tables.settings.minDownPct}%
                <span className="text-xs text-muted-foreground">ถ้าวันหลังเปลี่ยนค่ากลาง รุ่นพวกนี้เปลี่ยนตาม</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="set" /> กำหนดเฉพาะรุ่นพวกนี้
                <NumberInput
                  aria-label="ดาวน์เฉพาะรุ่น (%)"
                  className="w-24"
                  min="0"
                  max="80"
                  step="1"
                  value={downValue}
                  onFocus={() => setDownMode('set')}
                  onChange={(e) => setDownValue(e.target.value)}
                />
                %
              </label>
              {needDown && (
                <p className="flex items-start gap-1.5 text-xs text-warning-strong leading-snug">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  กรอกตัวเลขก่อนบันทึก
                </p>
              )}
            </RadioGroup>
          </fieldset>

          {lines.length > 0 && (
            <div className="rounded-lg border border-border bg-muted p-3 text-sm leading-snug">
              <p className="font-medium">จะเปลี่ยน:</p>
              <ul className="list-disc pl-5">
                {lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              {example?.before && example.after && (
                <p className="mt-2 text-muted-foreground">
                  ตัวอย่าง {example.label} ขาย {fmt(example.after.salePrice)} · ดาวน์ลูกค้า {fmt(example.before.down)} →{' '}
                  {fmt(example.after.down)} · ผ่อน {fmt(example.before.monthly)} → {fmt(example.after.monthly)} ×{' '}
                  {example.after.months}
                </p>
              )}
            </div>
          )}
          {tooMany && (
            <p className="flex items-start gap-1.5 text-sm text-warning-strong leading-snug">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>เลือกได้ไม่เกิน {MAX_ROWS} แถวต่อครั้ง</span>
            </p>
          )}
          {error && error !== 'ยังไม่ได้เปลี่ยนอะไร' && (
            <p className="flex items-start gap-1.5 text-sm text-warning-strong leading-snug">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}
          <p className="text-xs text-muted-foreground leading-snug">
            บันทึกทั้ง {rows.length} แถวพร้อมกัน — พลาดแถวเดียวไม่บันทึกเลย · แก้แถวเดิมของรุ่นนั้น ไม่สร้างซ้ำ · เก็บประวัติ
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            ยกเลิก
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending || error !== null || tooMany}>
            บันทึก {rows.length} รุ่น
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
