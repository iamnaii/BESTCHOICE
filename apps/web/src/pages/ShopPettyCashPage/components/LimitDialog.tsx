import { NumberInput } from '@/components/ui/NumberInput';
import { useEffect, useId, useState } from 'react';
import { Info } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formControlClass, formLabelClass } from '@/components/ui/form-styles';
import { cn } from '@/lib/utils';
import type { PettyCashSummary } from '../types';
import { PETTY_CASH_MAX_LIMIT, hasMoreThanTwoDecimals, money, parseAmount } from '../petty-cash.util';

export interface LimitDialogProps {
  open: boolean;
  limit: PettyCashSummary['limit'];
  balance: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (limit: number) => void;
}

const PRESETS = [10000, 20000, 30000, 50000];

/** ตั้งวงเงินเงินสดย่อย (OWNER · mockup กระดาน 4) — ค่าตั้งค่าตัวเดียวทั้งร้าน ไม่มีผลกับบัญชี แค่คุมปุ่มเติม */
export function LimitDialog({ open, limit, balance, pending, onClose, onSubmit }: LimitDialogProps) {
  const id = useId();
  const [value, setValue] = useState(Number(limit.value).toFixed(2));
  useEffect(() => {
    if (open) setValue(Number(limit.value).toFixed(2));
  }, [open, limit.value]);

  const parsed = parseAmount(value);
  const error =
    value.trim() === '' || parsed == null ? 'กรอกวงเงินเป็นตัวเลข'
    : parsed < 0 ? 'วงเงินต้องเป็น 0 ขึ้นไป'
    : hasMoreThanTwoDecimals(value) ? 'ทศนิยมได้ไม่เกิน 2 ตำแหน่ง'
    : parsed > PETTY_CASH_MAX_LIMIT ? 'วงเงินต้องไม่เกิน 1,000,000 บาท'
    : null;
  const belowBalance = !error && parsed != null && parsed < Number(balance);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        <DialogHeader className="mb-0 shrink-0 border-b border-border/50 px-6 py-4">
          <DialogTitle className="text-lg">ตั้งวงเงินเงินสดย่อย</DialogTitle>
          <DialogDescription className="text-xs leading-snug">วงเงิน = ยอดสูงสุดที่ถือเป็นเงินสดย่อยได้ · เติมได้ไม่เกิน วงเงิน − คงเหลือ</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 py-4">
          <div>
            <label className={formLabelClass} htmlFor={id}>วงเงินเงินสดย่อย (บาท)</label>
            <NumberInput unstyled id={id} inputMode="decimal" step="0.01" min="0" value={value} onChange={(e) => setValue(e.target.value)}
              aria-invalid={!!error} aria-describedby={`${id}-hint`}
              className={cn(formControlClass, 'text-right font-mono text-lg tabular-nums', error && 'border-destructive')} />
            <p id={`${id}-hint`} className={cn('mt-1 text-xs leading-snug', error ? 'text-destructive' : belowBalance ? 'text-warning-strong' : 'text-muted-foreground')}>
              {error
                ?? (belowBalance
                  ? `ต่ำกว่ายอดคงเหลือ ${money(balance)} บาท — หน้าจะบอก "เกินวงเงิน" และเติมไม่ได้จนกว่าจะคืนเงิน`
                  : limit.source === 'DEFAULT'
                    ? `ยังไม่เคยตั้ง — ใช้ค่าเริ่มต้น ${money(limit.value)} บาท · คงเหลือตอนนี้ ${money(balance)}`
                    : `ค่าปัจจุบัน ${money(limit.value)} · คงเหลือตอนนี้ ${money(balance)}`)}
            </p>
          </div>
          <div>
            <span className={formLabelClass}>วงเงินที่ใช้บ่อย</span>
            <div role="group" aria-label="วงเงินที่ใช้บ่อย" className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <Button key={preset} type="button" variant={parsed === preset ? 'primary' : 'outline'} size="sm" className="min-h-11 font-mono tabular-nums" onClick={() => setValue(preset.toFixed(2))}>
                  {preset.toLocaleString('en-US')}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-border/50 bg-muted/40 p-3 text-xs leading-snug text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>ค่าตั้งค่าตัวเดียวของทั้งร้าน (เงินสดย่อยกองเดียว ไม่แยกสาขา ไม่ระบุผู้ถือ) · เจ้าของ เท่านั้นที่แก้ได้ · ไม่มีผลกับบัญชี แค่คุมปุ่มเติม</span>
          </div>
        </div>
        <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-end gap-2 border-t border-border/50 px-6 py-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>ยกเลิก</Button>
          <Button type="button" variant="primary" disabled={!!error || pending} onClick={() => parsed != null && !error && onSubmit(Number(parsed.toFixed(2)))}>
            {pending ? 'กำลังบันทึก…' : 'บันทึกวงเงิน'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
