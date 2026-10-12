import { useEffect, useMemo, useState } from 'react';
import { Paperclip, Receipt } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { cn } from '@/lib/utils';
import { formatNumberDecimal } from '@/utils/formatters';
import type { CancelPOPayload } from '../types';
import { fieldCls, labelCls } from './wizard/chrome';
import { SHOP_RECEIVING_BANK, cancelOutcomeErrors, cancelPreviewLines, todayIso, type CancelOutcomeForm } from '../supplier-payment.util';

/**
 * ผลของเงินมัดจำค้างตอนปิดใบสั่งซื้อ (ได้คืน → S11-1201 · ส่วนที่ได้คืนไม่ครบ / ไม่ได้คืน → S53-1105) — คำตัดสินเจ้าของ 2026-10-05 ข้อ 6
 * ใช้ร่วมกันโดย "ยกเลิก PO" (CancelPODialog) และ "ปิดใบ รับไม่ครบ" (ClosePOShortDialog — 2026-10-11): กล่องสองใบ กติกาเดียว
 * ตัวช่วยสถานะ (`useDepositOutcome`) ถือฟอร์ม/การตรวจ/พรีวิวรายการบัญชี · ชิ้นส่วน (`DepositOutcomeFields`) วาดตัวเลือกสองทาง + ตารางพรีวิว
 */
export type DepositOutcomeChoice = 'REFUNDED' | 'FORFEITED';

const money = (v: string | number) => formatNumberDecimal(Number(v) || 0, 2);
const emptyForm = (outstanding: number): CancelOutcomeForm => ({
  depositOutcome: 'REFUNDED',
  refundedAt: todayIso(),
  refundAmount: outstanding > 0 ? String(outstanding) : '',
  slipUrl: '',
  reason: '',
});

export function useDepositOutcome({ open, poId, outstanding }: { open: boolean; poId: string | undefined; outstanding: number }) {
  const [outcome, setOutcome] = useState<DepositOutcomeChoice | null>(null);
  const [form, setForm] = useState<CancelOutcomeForm>(() => emptyForm(0));
  const [slipName, setSlipName] = useState('');

  useEffect(() => {
    if (!open) return;
    setOutcome(null);
    setForm(emptyForm(outstanding));
    setSlipName('');
  }, [open, poId, outstanding]);

  const activeForm = useMemo<CancelOutcomeForm>(() => ({ ...form, depositOutcome: outcome ?? 'REFUNDED' }), [form, outcome]);
  const errors = useMemo(() => (outcome ? cancelOutcomeErrors(activeForm, outstanding) : {}), [activeForm, outcome, outstanding]);
  const lines = useMemo(() => (outcome ? cancelPreviewLines(activeForm, outstanding) : []), [activeForm, outcome, outstanding]);
  const needsOutcome = outstanding > 0;
  /** ไม่มีมัดจำค้าง = ผ่านเสมอ · มี = ต้องเลือกทางและกรอกครบ */
  const valid = !needsOutcome || (!!outcome && Object.keys(errors).length === 0);
  const set = (patch: Partial<CancelOutcomeForm>) => setForm((f) => ({ ...f, ...patch }));
  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      set({ slipUrl: String(reader.result ?? '') });
      setSlipName(file.name);
    };
    reader.readAsDataURL(file);
  };
  /** ไม่มีมัดจำค้าง → undefined (ไม่ส่งผลมัดจำ) */
  const payload = (): CancelPOPayload | undefined => {
    if (!needsOutcome) return undefined;
    if (outcome === 'REFUNDED') {
      return { depositOutcome: 'REFUNDED', refundedAt: form.refundedAt, refundAmount: Number(form.refundAmount), slipUrl: form.slipUrl.trim(), reason: form.reason.trim() || undefined };
    }
    return { depositOutcome: 'FORFEITED', reason: form.reason.trim() };
  };

  /** พิมพ์ลิงก์รูปเอง = เลิกใช้ไฟล์ที่เลือกไว้ (ชื่อไฟล์หายจากช่อง) */
  const setSlipUrlText = (value: string) => {
    set({ slipUrl: value });
    setSlipName('');
  };

  return { outcome, setOutcome, form, set, slipName, onPickFile, setSlipUrlText, errors, lines, needsOutcome, valid, payload };
}

export type DepositOutcomeState = ReturnType<typeof useDepositOutcome>;

export function DepositOutcomeFields({ state, idPrefix }: { state: DepositOutcomeState; idPrefix: string }) {
  const { outcome, setOutcome, form, set, slipName, onPickFile, setSlipUrlText, errors, lines } = state;
  return (
    <>
      <label className={cn('flex cursor-pointer gap-3 rounded-xl border p-4', outcome === 'REFUNDED' ? 'border-primary bg-primary/5' : 'border-border bg-card')}>
        <input type="radio" name={`${idPrefix}-deposit-outcome`} aria-label="ได้เงินมัดจำคืน" className="mt-1" checked={outcome === 'REFUNDED'} onChange={() => setOutcome('REFUNDED')} />
        <div className="flex-1 space-y-3">
          <div>
            <div className="font-semibold">ได้เงินมัดจำคืน</div>
            <div className="text-xs text-muted-foreground">ผู้จัดจำหน่ายโอนคืนเข้าบัญชีธนาคารหน้าร้าน</div>
          </div>
          {outcome === 'REFUNDED' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className={labelCls}>วันที่ได้รับเงินคืน</div>
                <ThaiDateInput aria-label="วันที่ได้รับเงินคืน" value={form.refundedAt} onChange={(e) => set({ refundedAt: e.target.value })} className={fieldCls} max={todayIso()} />
                {errors.refundedAt && <p className="mt-1 text-xs text-destructive">{errors.refundedAt}</p>}
              </div>
              <div>
                <label className={labelCls} htmlFor={`${idPrefix}-refund-amount`}>จำนวนที่ได้คืน (บาท)</label>
                <input id={`${idPrefix}-refund-amount`} type="number" min="0" step="0.01" className={cn(fieldCls, 'text-right font-mono font-semibold tabular-nums')} value={form.refundAmount} onChange={(e) => set({ refundAmount: e.target.value })} />
                <p className={cn('mt-1 text-xs', errors.refundAmount ? 'text-destructive' : 'text-muted-foreground')}>{errors.refundAmount ?? 'ถ้าได้คืนไม่ครบ ส่วนต่างลงเป็นค่าใช้จ่าย'}</p>
              </div>
              <div>
                <div className={labelCls}>เข้าบัญชี</div>
                <div className={cn(fieldCls, 'flex items-center justify-between bg-muted/40 text-muted-foreground')}>
                  <span>{SHOP_RECEIVING_BANK.label}</span>
                  <span className="font-mono text-xs">{SHOP_RECEIVING_BANK.code}</span>
                </div>
              </div>
              <div>
                <div className={labelCls}>หลักฐานการโอนคืน <span className="text-destructive">*</span></div>
                <label className={cn(fieldCls, 'flex cursor-pointer items-center gap-2 border-dashed text-muted-foreground hover:bg-accent')}>
                  <Paperclip className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{slipName || (form.slipUrl ? 'แนบแล้ว' : 'เลือกรูป')}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={onPickFile} />
                </label>
                <label className="sr-only" htmlFor={`${idPrefix}-refund-slip-url`}>ลิงก์หลักฐานการโอนคืน</label>
                <input
                  id={`${idPrefix}-refund-slip-url`}
                  type="text"
                  className={cn(fieldCls, 'mt-2')}
                  placeholder="หรือวางลิงก์รูป"
                  value={form.slipUrl.startsWith('data:') ? '' : form.slipUrl}
                  onChange={(e) => setSlipUrlText(e.target.value)}
                />
                {errors.slipUrl && <p className="mt-1 text-xs text-destructive">{errors.slipUrl}</p>}
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor={`${idPrefix}-refund-note`}>หมายเหตุ</label>
                <input id={`${idPrefix}-refund-note`} type="text" className={fieldCls} value={form.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="เช่น หักค่าดำเนินการ 500" />
              </div>
            </div>
          )}
        </div>
      </label>

      <label className={cn('flex cursor-pointer gap-3 rounded-xl border p-4', outcome === 'FORFEITED' ? 'border-primary bg-primary/5' : 'border-border bg-card')}>
        <input type="radio" name={`${idPrefix}-deposit-outcome`} aria-label="ไม่ได้เงินมัดจำคืน" className="mt-1" checked={outcome === 'FORFEITED'} onChange={() => setOutcome('FORFEITED')} />
        <div className="flex-1 space-y-3">
          <div>
            <div className="font-semibold">ไม่ได้เงินมัดจำคืน</div>
            <div className="text-xs text-muted-foreground">ผู้จัดจำหน่ายริบมัดจำ หรือตามเงินไม่ได้ · ลงเป็นค่าใช้จ่ายตามคำตอบฝ่ายบัญชีข้อ 9.2</div>
          </div>
          {outcome === 'FORFEITED' && (
            <div>
              <div className={labelCls}>เหตุผล <span className="text-destructive">*</span></div>
              <textarea aria-label="เหตุผล" rows={2} className={cn(fieldCls, 'h-auto py-2')} value={form.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="เช่น ผู้จัดจำหน่ายริบมัดจำเพราะยกเลิกหลังสั่งของแล้ว" />
              {errors.reason && <p className="mt-1 text-xs text-destructive">{errors.reason}</p>}
            </div>
          )}
        </div>
      </label>

      {lines.length > 0 && (
        <section className="rounded-xl border border-info/30 bg-info/5 p-4" aria-label="รายการบัญชีที่จะลง">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-info">
            <Receipt className="size-4" aria-hidden />
            รายการบัญชีที่จะลงอัตโนมัติ · สมุดหน้าร้าน
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-1 text-left font-medium">รหัส</th>
                <th className="py-1 text-left font-medium">ชื่อบัญชี</th>
                <th className="py-1 text-right font-medium">เดบิต</th>
                <th className="py-1 text-right font-medium">เครดิต</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr key={`${line.accountCode}-${idx}`} className="border-t border-border/40">
                  <td className="py-1 font-mono text-xs">{line.accountCode}</td>
                  <td className={cn('py-1', line.credit > 0 && 'pl-6')}>{line.label}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{line.debit > 0 ? money(line.debit) : ''}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{line.credit > 0 ? money(line.credit) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
