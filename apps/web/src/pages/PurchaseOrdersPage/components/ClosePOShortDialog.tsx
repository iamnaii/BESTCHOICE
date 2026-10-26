import { useEffect, useState } from 'react';
import { AlertTriangle, PackageX } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatNumberDecimal } from '@/utils/formatters';
import type { ClosePOShortPayload, POItem, PurchaseOrder, SupplierPaymentSummary } from '../types';
import { fieldCls, labelCls } from './wizard/chrome';
import { accessoryTitle, isAccessory, receivingProgress } from '../po-detail.util';
import { DepositOutcomeFields, useDepositOutcome } from './DepositOutcomeFields';

export interface ClosePOShortDialogProps {
  open: boolean;
  po: PurchaseOrder | null;
  /** ฐานะจากสมุดบัญชี — มัดจำค้าง > 0 จึงต้องเลือกผล · null/กำลังโหลด = ยังตอบไม่ได้ว่ามีมัดจำไหม */
  summary: SupplierPaymentSummary | null | undefined;
  summaryLoading: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: (payload: ClosePOShortPayload) => void;
}

const money = (v: string | number) => formatNumberDecimal(Number(v) || 0, 2);
const itemTitle = (item: POItem) => (isAccessory(item) ? accessoryTitle(item) : [item.brand, item.model, item.storage].filter(Boolean).join(' '));

/**
 * ปิดใบ รับไม่ครบ (คำตัดสินเจ้าของ 2026-10-11 — mockup "ปิดใบ รับไม่ครบ" เคาะทั้ง 4 ข้อ): ใบที่รับของบางส่วนแล้วผู้จัดจำหน่าย
 * ไม่ส่งที่เหลือ — OWNER/BM ปิดได้ · ปิดแล้วแก้ไม่ได้ (ของที่มาทีหลังเปิดใบใหม่) · ยอดสุทธิคงเดิม แต่จ่ายได้ไม่เกินของที่รับจริง ·
 * ใบหายจากการ์ด "รับบางส่วน"/"เลยกำหนดส่ง" · มัดจำค้าง (ถ้ามี) ระบุผลแบบเดียวกับยกเลิกใบ (DepositOutcomeFields)
 */
export function ClosePOShortDialog({ open, po, summary, summaryLoading, pending, onClose, onConfirm }: ClosePOShortDialogProps) {
  const outstanding = Number(summary?.depositOutstanding) || 0;
  const deposit = useDepositOutcome({ open, poId: po?.id, outstanding });
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open, po?.id]);

  const reasonOk = reason.trim().length > 0;
  const canConfirm = !pending && !summaryLoading && reasonOk && deposit.valid;

  if (!po) return null;
  const goods = receivingProgress(po);
  const shortItems = po.items.filter((i) => i.receivedQty < i.quantity);
  const confirm = () => {
    if (!canConfirm) return;
    const d = deposit.payload();
    onConfirm({
      reason: reason.trim(),
      ...(d ? { depositOutcome: d.depositOutcome, refundedAt: d.refundedAt, refundAmount: d.refundAmount, slipUrl: d.slipUrl, depositReason: d.reason } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-2xl gap-0 p-0" aria-describedby={undefined}>
        <DialogHeader className="border-b border-border/50 px-6 py-4">
          <DialogTitle className="text-lg">ปิดใบ รับไม่ครบ {po.poNumber}</DialogTitle>
          <DialogDescription className="text-xs">{po.supplier.name} · ผู้จัดจำหน่ายไม่ส่งของที่เหลือ</DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(100vh-14rem)] space-y-3 overflow-y-auto px-6 py-4">
          <section className="rounded-xl border border-border bg-card p-4" aria-label="ของที่จะไม่รับ">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-warning/10 text-warning-strong">
                <PackageX className="size-4.5" aria-hidden />
              </div>
              <div className="text-sm leading-snug">
                <span className="font-semibold text-foreground">รับแล้ว {goods.received} / {goods.total} ชิ้น</span>
                <span className="text-muted-foreground"> · จะไม่รับอีก </span>
                <span className="font-mono font-semibold tabular-nums text-warning-strong" data-testid="close-short-unreceived">{goods.remaining}</span>
                <span className="text-muted-foreground"> ชิ้น</span>
              </div>
            </div>
            {shortItems.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {shortItems.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 leading-snug">
                    <span className="truncate text-foreground">{itemTitle(item)}</span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      รับ {item.receivedQty}/{item.quantity} · ไม่รับ {item.quantity - item.receivedQty}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-strong">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <ul className="space-y-1 leading-snug">
              <li>ปิดแล้วแก้ไม่ได้ — ของที่มาทีหลังต้องเปิดใบสั่งซื้อใหม่</li>
              <li>
                ยอดสุทธิของใบคงเดิม <span className="font-mono font-semibold tabular-nums">{money(po.netAmount)}</span> บาท
                แต่จ่ายได้ไม่เกินมูลค่าของที่รับจริงตามบัญชี
              </li>
              <li>ใบจะหายจากการ์ด "รับบางส่วน" และ "เลยกำหนดส่ง" · ยังอยู่ในเจ้าหนี้จนกว่าจะจ่ายค่าของที่รับแล้วครบ</li>
            </ul>
          </div>

          <div>
            <label className={labelCls} htmlFor="close-short-reason">เหตุผลที่ปิดใบ <span className="text-destructive">*</span></label>
            <textarea
              id="close-short-reason"
              rows={2}
              className={cn(fieldCls, 'h-auto py-2')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น ผู้จัดจำหน่ายแจ้งว่าของหมด ไม่ส่งที่เหลือ"
              maxLength={500}
            />
          </div>

          {summaryLoading && <p className="text-xs text-muted-foreground">กำลังตรวจมัดจำค้างจากสมุดบัญชี…</p>}
          {deposit.needsOutcome && (
            <>
              <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-strong">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  ใบนี้มีมัดจำค้าง <span className="font-mono font-semibold tabular-nums">{money(outstanding)}</span> บาท ที่ยังไม่ได้หักเข้าเจ้าหนี้
                  (ของที่ไม่มาจะไม่มีเจ้าหนี้ให้หัก) — ต้องระบุว่าได้เงินคืนหรือไม่ จึงจะปิดใบได้
                </span>
              </div>
              <DepositOutcomeFields state={deposit} idPrefix="close-short" />
            </>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-border/50 px-6 py-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>กลับ</Button>
          <Button type="button" variant="primary" disabled={!canConfirm} onClick={confirm}>
            {pending ? 'กำลังปิดใบ…' : 'ยืนยันปิดใบ รับไม่ครบ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
