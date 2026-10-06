import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Paperclip, Receipt } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { cn } from '@/lib/utils';
import { formatDateShort, formatNumberDecimal } from '@/utils/formatters';
import type { CancelPOPayload, PurchaseOrder, SupplierPaymentSummary } from '../types';
import { fieldCls, labelCls } from './wizard/chrome';
import { SHOP_RECEIVING_BANK, cancelOutcomeErrors, cancelPreviewLines, todayIso, type CancelOutcomeForm } from '../supplier-payment.util';

export interface CancelPODialogProps {
  open: boolean;
  po: PurchaseOrder | null;
  /** ฐานะจากสมุดบัญชี — มัดจำค้าง > 0 จึงต้องเลือกผล · null/กำลังโหลด = ยังตอบไม่ได้ว่ามีมัดจำไหม */
  summary: SupplierPaymentSummary | null | undefined;
  summaryLoading: boolean;
  pending: boolean;
  onClose: () => void;
  /** ไม่มีมัดจำค้าง → undefined (ยกเลิกเหมือนเดิม) */
  onConfirm: (payload: CancelPOPayload | undefined) => void;
}

const money = (v: string | number) => formatNumberDecimal(Number(v) || 0, 2);
const emptyForm = (outstanding: number): CancelOutcomeForm => ({
  depositOutcome: 'REFUNDED',
  refundedAt: todayIso(),
  refundAmount: outstanding > 0 ? String(outstanding) : '',
  slipUrl: '',
  reason: '',
});

/**
 * ยกเลิกใบสั่งซื้อ (ก้อน 2 · กระดาน 4): ใบที่มีมัดจำค้างต้องบอกว่าได้เงินคืน (→ ธนาคารรับเข้า S11-1201, ส่วนที่ได้คืนไม่ครบ → S53-1105)
 * หรือไม่ได้คืน (→ S53-1105) ก่อนยกเลิก — คำตัดสินเจ้าของ 2026-10-05 ข้อ 6 · ใบที่ไม่เคยจ่ายเงินยกเลิกได้ทันทีเหมือนเดิม
 */
export function CancelPODialog({ open, po, summary, summaryLoading, pending, onClose, onConfirm }: CancelPODialogProps) {
  const outstanding = Number(summary?.depositOutstanding) || 0;
  const [outcome, setOutcome] = useState<'REFUNDED' | 'FORFEITED' | null>(null);
  const [form, setForm] = useState<CancelOutcomeForm>(() => emptyForm(0));
  const [slipName, setSlipName] = useState('');

  useEffect(() => {
    if (!open) return;
    setOutcome(null);
    setForm(emptyForm(outstanding));
    setSlipName('');
  }, [open, po?.id, outstanding]);

  const activeForm = useMemo<CancelOutcomeForm>(() => ({ ...form, depositOutcome: outcome ?? 'REFUNDED' }), [form, outcome]);
  const errors = useMemo(() => (outcome ? cancelOutcomeErrors(activeForm, outstanding) : {}), [activeForm, outcome, outstanding]);
  const lines = useMemo(() => (outcome ? cancelPreviewLines(activeForm, outstanding) : []), [activeForm, outcome, outstanding]);
  const needsOutcome = outstanding > 0;
  const canConfirm = !pending && !summaryLoading && (!needsOutcome || (!!outcome && Object.keys(errors).length === 0));
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

  if (!po) return null;
  const confirm = () => {
    if (!canConfirm) return;
    if (!needsOutcome) return onConfirm(undefined);
    if (outcome === 'REFUNDED') {
      onConfirm({ depositOutcome: 'REFUNDED', refundedAt: form.refundedAt, refundAmount: Number(form.refundAmount), slipUrl: form.slipUrl.trim(), reason: form.reason.trim() || undefined });
    } else {
      onConfirm({ depositOutcome: 'FORFEITED', reason: form.reason.trim() });
    }
  };
  const paidWhen = po.orderDate ? formatDateShort(po.orderDate) : '';

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-2xl gap-0 p-0" aria-describedby={undefined}>
        <DialogHeader className="border-b border-border/50 px-6 py-4">
          <DialogTitle className="text-lg">ยกเลิกใบสั่งซื้อ {po.poNumber}</DialogTitle>
          <DialogDescription className="text-xs">
            {po.supplier.name}
            {po.status === 'ORDERED' ? ' · ยกเลิกแล้วต้องแจ้งผู้ขายเอง' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(100vh-14rem)] space-y-3 overflow-y-auto px-6 py-4">
          {summaryLoading && <p className="text-xs text-muted-foreground">กำลังตรวจมัดจำค้างจากสมุดบัญชี…</p>}
          {needsOutcome ? (
            <>
              <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-strong">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  ใบนี้จ่ายมัดจำไปแล้ว <span className="font-mono font-semibold tabular-nums">{money(outstanding)}</span> บาท{paidWhen ? ` (สั่งซื้อ ${paidWhen})` : ''} · ยังไม่รับของ —
                  ต้องระบุก่อนว่าได้เงินคืนหรือไม่ จึงจะยกเลิกได้
                </span>
              </div>

              <label className={cn('flex cursor-pointer gap-3 rounded-xl border p-4', outcome === 'REFUNDED' ? 'border-primary bg-primary/5' : 'border-border bg-card')}>
                <input type="radio" name="deposit-outcome" aria-label="ได้เงินมัดจำคืน" className="mt-1" checked={outcome === 'REFUNDED'} onChange={() => setOutcome('REFUNDED')} />
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
                        <label className={labelCls} htmlFor="cancel-refund-amount">จำนวนที่ได้คืน (บาท)</label>
                        <input id="cancel-refund-amount" type="number" min="0" step="0.01" className={cn(fieldCls, 'text-right font-mono font-semibold tabular-nums')} value={form.refundAmount} onChange={(e) => set({ refundAmount: e.target.value })} />
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
                        <label className="sr-only" htmlFor="cancel-refund-slip-url">ลิงก์หลักฐานการโอนคืน</label>
                        <input
                          id="cancel-refund-slip-url"
                          type="text"
                          className={cn(fieldCls, 'mt-2')}
                          placeholder="หรือวางลิงก์รูป"
                          value={form.slipUrl.startsWith('data:') ? '' : form.slipUrl}
                          onChange={(e) => {
                            set({ slipUrl: e.target.value });
                            setSlipName('');
                          }}
                        />
                        {errors.slipUrl && <p className="mt-1 text-xs text-destructive">{errors.slipUrl}</p>}
                      </div>
                      <div className="sm:col-span-2">
                        <label className={labelCls} htmlFor="cancel-refund-note">หมายเหตุ</label>
                        <input id="cancel-refund-note" type="text" className={fieldCls} value={form.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="เช่น หักค่าดำเนินการ 500" />
                      </div>
                    </div>
                  )}
                </div>
              </label>

              <label className={cn('flex cursor-pointer gap-3 rounded-xl border p-4', outcome === 'FORFEITED' ? 'border-primary bg-primary/5' : 'border-border bg-card')}>
                <input type="radio" name="deposit-outcome" aria-label="ไม่ได้เงินมัดจำคืน" className="mt-1" checked={outcome === 'FORFEITED'} onChange={() => setOutcome('FORFEITED')} />
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
          ) : (
            !summaryLoading && (
              <p className="text-sm text-foreground">
                ต้องการยกเลิก {po.poNumber}?
                {po.status === 'ORDERED' ? ' สั่งซื้อแล้วแต่ยังไม่ได้รับของ — ยกเลิกแล้วต้องแจ้งผู้ขายเอง' : ''}
                {' '}ใบนี้ยังไม่ได้จ่ายเงิน ยกเลิกได้ทันที
              </p>
            )
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-border/50 px-6 py-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>กลับ</Button>
          <Button type="button" variant="destructive" disabled={!canConfirm} onClick={confirm}>
            {pending ? 'กำลังยกเลิก…' : 'ยืนยันยกเลิกใบสั่งซื้อ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
