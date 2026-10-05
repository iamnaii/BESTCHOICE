import { useEffect, useMemo, useState } from 'react';
import { Building2, Landmark, Paperclip, Receipt } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { cn } from '@/lib/utils';
import { formatNumberDecimal } from '@/utils/formatters';
import type { PurchaseOrder, RecordSupplierPaymentPayload, SupplierPayment, SupplierPaymentSummary } from '../types';
import { fieldCls, labelCls } from './wizard/chrome';
import {
  PAYMENT_KIND_LABEL,
  SHOP_PAYING_BANK,
  paymentChip,
  paymentFormErrors,
  previewLines,
  todayIso,
  type SupplierPaymentForm,
} from '../supplier-payment.util';

export interface SupplierPaymentDialogProps {
  open: boolean;
  po: PurchaseOrder | null;
  /** จาก `GET /purchase-orders/:id/payments` — ฐานะจากสมุดบัญชี (ชนิดรายการ/เพดานคิดจากตัวนี้) */
  summary: SupplierPaymentSummary | null | undefined;
  summaryLoading: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (payload: RecordSupplierPaymentPayload) => void;
}

const money = (v: string | number) => formatNumberDecimal(Number(v) || 0, 2);
const emptyForm = (): SupplierPaymentForm => ({ paidAt: todayIso(), amount: '', slipUrl: '', reference: '', note: '' });

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div>
      <div className={labelCls}>{label}</div>
      <div className={cn('font-mono text-base font-semibold tabular-nums', tone)}>{value}</div>
      {hint && <div className="text-xs leading-snug text-muted-foreground">{hint}</div>}
    </div>
  );
}

/**
 * บันทึกการจ่ายเงินผู้จัดจำหน่าย (ก้อน 2 · แบบหน้าจอกระดาน 1/2 ที่เจ้าของเคาะ 2026-10-05):
 * โอนธนาคารเท่านั้นจาก S11-1202 · สลิปบังคับ · ชนิดรายการโปรแกรมตัดสินจากฐานะ (มีเจ้าหนี้ = ชำระ ไม่งั้น = มัดจำ) ·
 * พรีวิวรายการบัญชีก่อนกด. Plain buttons — ไม่ใช้ submit (ดู CreatePOModal เรื่อง type-flip)
 */
export function SupplierPaymentDialog({ open, po, summary, summaryLoading, pending, onClose, onSubmit }: SupplierPaymentDialogProps) {
  const [form, setForm] = useState<SupplierPaymentForm>(emptyForm);
  const [slipName, setSlipName] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm({ ...emptyForm(), amount: summary && Number(summary.payableOutstanding) > 0 ? String(Number(summary.payableOutstanding)) : '' });
    setSlipName('');
  }, [open, po?.id, summary?.payableOutstanding]);

  const errors = useMemo(() => (summary ? paymentFormErrors(form, summary) : {}), [form, summary]);
  const amountNumber = Number(form.amount) || 0;
  const lines = useMemo(() => (summary ? previewLines(summary, amountNumber) : []), [summary, amountNumber]);
  const chip = summary ? paymentChip(summary) : null;
  const canSubmit = !!summary && !summaryLoading && !pending && Object.keys(errors).length === 0;

  const set = (patch: Partial<SupplierPaymentForm>) => setForm((f) => ({ ...f, ...patch }));
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
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-2xl gap-0 p-0" aria-describedby={undefined}>
        <DialogHeader className="border-b border-border/50 px-6 py-4">
          <DialogTitle className="text-lg">บันทึกการจ่ายเงิน {po.poNumber}</DialogTitle>
          <DialogDescription className="text-xs">
            {po.supplier.name} · โอนธนาคารเท่านั้น (ไม่มีจ่ายเงินสด) · ลงบัญชีสมุดหน้าร้านทันทีที่บันทึก
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(100vh-14rem)] space-y-4 overflow-y-auto px-6 py-4">
          <section className="grid grid-cols-2 gap-3 rounded-xl border border-border/50 bg-card p-4 shadow-sm sm:grid-cols-4" aria-label="ฐานะใบสั่งซื้อ">
            <Tile label="ยอดสุทธิ" value={money(summary?.netAmount ?? po.netAmount)} />
            <Tile label="จ่ายแล้ว" value={money(summary?.paidTotal ?? po.paidAmount)} tone="text-success" />
            {summary && Number(summary.payableOutstanding) > 0 ? (
              <Tile label="เจ้าหนี้คงเหลือ" value={money(summary.payableOutstanding)} tone="text-destructive" hint="จากรายการรับของในสมุดบัญชี" />
            ) : (
              <Tile label="มัดจำค้าง" value={money(summary?.depositOutstanding ?? 0)} tone="text-warning-strong" hint="ยังไม่รับของ" />
            )}
            <Tile label="จ่ายได้อีกไม่เกิน" value={money(summary?.remainingOnPo ?? 0)} hint="ยอดสุทธิ − จ่ายแล้ว" />
          </section>

          <section className="rounded-xl border border-border/50 bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-md bg-success/10 text-success"><Landmark className="size-4" aria-hidden /></div>
                <h3 className="text-sm font-semibold text-foreground">รายละเอียดการโอน</h3>
              </div>
              {summaryLoading ? (
                <span className="text-xs text-muted-foreground">กำลังอ่านฐานะจากสมุดบัญชี…</span>
              ) : chip ? (
                <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', chip.tone === 'settlement' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning-strong')}>
                  {chip.label}
                </span>
              ) : null}
            </div>
            {chip?.tone === 'deposit' && (
              <p className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-snug text-warning-strong">
                ยังไม่รับของ โปรแกรมจะลงเป็นเงินมัดจำ (S11-4201) ไม่ใช่เจ้าหนี้ · ตอนรับของ มัดจำจะถูกหักเข้าเจ้าหนี้ให้อัตโนมัติ ไม่ต้องกดอะไรเพิ่ม
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className={labelCls}>วันที่โอน</div>
                <ThaiDateInput aria-label="วันที่โอน" value={form.paidAt} onChange={(e) => set({ paidAt: e.target.value })} className={fieldCls} max={todayIso()} />
                {errors.paidAt && <p className="mt-1 text-xs text-destructive">{errors.paidAt}</p>}
              </div>
              <div>
                <label className={labelCls} htmlFor="sp-amount">จำนวนเงิน (บาท)</label>
                <input
                  id="sp-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className={cn(fieldCls, 'text-right font-mono font-semibold tabular-nums')}
                  value={form.amount}
                  onChange={(e) => set({ amount: e.target.value })}
                />
                <p className={cn('mt-1 text-xs', errors.amount && form.amount !== '' ? 'text-destructive' : 'text-muted-foreground')}>
                  {errors.amount && form.amount !== '' ? errors.amount : `จ่ายได้อีกไม่เกิน ${money(summary?.remainingOnPo ?? 0)} บาท`}
                </p>
              </div>
              <div>
                <div className={labelCls}>โอนจากบัญชี</div>
                <div className={cn(fieldCls, 'flex items-center justify-between bg-muted/40 text-muted-foreground')}>
                  <span>{SHOP_PAYING_BANK.label}</span>
                  <span className="font-mono text-xs">{SHOP_PAYING_BANK.code}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">โอนธนาคารเท่านั้น · ไม่มีจ่ายเงินสด</p>
              </div>
              <div>
                <div className={labelCls}>โอนเข้าบัญชีผู้จัดจำหน่าย</div>
                <div className={cn(fieldCls, 'flex items-center justify-between bg-muted/40 text-muted-foreground')}>
                  <span className="flex items-center gap-1.5 truncate"><Building2 className="size-3.5 shrink-0" aria-hidden />{po.bankNameSnapshot || po.supplier.name}</span>
                  <span className="font-mono text-xs">{po.bankAccountSnapshot || '—'}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">ตามบัญชีที่บันทึกไว้ตอนออกใบสั่งซื้อ</p>
              </div>
              <div>
                <div className={labelCls}>สลิปโอนเงิน <span className="text-destructive">*</span></div>
                <div className="flex items-center gap-2">
                  <label className={cn(fieldCls, 'flex cursor-pointer items-center gap-2 border-dashed text-muted-foreground hover:bg-accent')}>
                    <Paperclip className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{slipName || (form.slipUrl ? 'แนบแล้ว' : 'เลือกรูปสลิป')}</span>
                    <input type="file" accept="image/*" className="hidden" onChange={onPickFile} />
                  </label>
                </div>
                <label className="sr-only" htmlFor="sp-slip-url">ลิงก์สลิป</label>
                <input
                  id="sp-slip-url"
                  type="text"
                  className={cn(fieldCls, 'mt-2')}
                  placeholder="หรือวางลิงก์รูปสลิป"
                  value={form.slipUrl.startsWith('data:') ? '' : form.slipUrl}
                  onChange={(e) => {
                    set({ slipUrl: e.target.value });
                    setSlipName('');
                  }}
                />
                {errors.slipUrl && <p className="mt-1 text-xs text-destructive">{errors.slipUrl}</p>}
              </div>
              <div>
                <label className={labelCls} htmlFor="sp-ref">เลขอ้างอิงการโอน</label>
                <input id="sp-ref" type="text" className={cn(fieldCls, 'font-mono')} value={form.reference} onChange={(e) => set({ reference: e.target.value })} placeholder="จากสลิป" />
                <label className={cn(labelCls, 'mt-3')} htmlFor="sp-note">หมายเหตุ</label>
                <input id="sp-note" type="text" className={fieldCls} value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder="เช่น จ่ายงวดสุดท้ายหลังตรวจรับครบ" />
              </div>
            </div>
          </section>

          {lines.length > 0 && (
            <section className="rounded-xl border border-info/30 bg-info/5 p-4" aria-label="รายการบัญชีที่จะลง">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-info">
                <Receipt className="size-4" aria-hidden />
                รายการบัญชีที่จะลงอัตโนมัติ · สมุดหน้าร้าน · ผู้จัดจำหน่าย: {po.supplier.name}
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
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-3 border-t border-border/50 px-6 py-3">
          <span className="text-xs text-muted-foreground">กดได้เฉพาะ เจ้าของ · ผู้จัดการสาขา</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>ยกเลิก</Button>
            <Button
              type="button"
              variant="primary"
              disabled={!canSubmit}
              onClick={() =>
                onSubmit({
                  paidAt: form.paidAt,
                  amount: Number(form.amount),
                  slipUrl: form.slipUrl.trim(),
                  reference: form.reference.trim() || undefined,
                  note: form.note.trim() || undefined,
                })
              }
            >
              {pending ? 'กำลังบันทึก…' : 'บันทึกและลงบัญชี'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface VoidSupplierPaymentDialogProps {
  open: boolean;
  payment: SupplierPayment | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

/** ยกเลิกรายการจ่ายที่บันทึกผิด (เจ้าของเท่านั้น — ข้อสมมติ ง): กลับรายการบัญชีเต็มจำนวน ลงวันที่ที่กด แล้วให้บันทึกใหม่ให้ถูก */
export function VoidSupplierPaymentDialog({ open, payment, pending, onClose, onConfirm }: VoidSupplierPaymentDialogProps) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open, payment?.id]);
  if (!payment) return null;
  const canConfirm = reason.trim().length > 0 && !pending;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-destructive">ยกเลิกรายการจ่าย {money(payment.amount)} บาท</DialogTitle>
          <DialogDescription className="text-xs">
            {PAYMENT_KIND_LABEL[payment.kind]} · รายการบัญชี {payment.journalEntryNo ?? '-'} — โปรแกรมจะกลับรายการเต็มจำนวนลงวันที่ที่กดยกเลิก แล้วให้บันทึกใหม่ให้ถูก
          </DialogDescription>
        </DialogHeader>
        <div>
          <label className={labelCls} htmlFor="sp-void-reason">เหตุผล <span className="text-destructive">*</span></label>
          <textarea
            id="sp-void-reason"
            rows={3}
            className={cn(fieldCls, 'h-auto py-2')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น กรอกยอดผิด ที่ถูกคือ 10,279.00"
          />
          <p className="mt-1 text-xs text-muted-foreground">กดได้เฉพาะเจ้าของกิจการ · รายการที่ระบบสร้างเอง (หักมัดจำ) ยกเลิกไม่ได้</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>กลับ</Button>
          <Button type="button" variant="destructive" disabled={!canConfirm} onClick={() => onConfirm(reason.trim())}>
            {pending ? 'กำลังยกเลิก…' : 'ยืนยันยกเลิกรายการ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
