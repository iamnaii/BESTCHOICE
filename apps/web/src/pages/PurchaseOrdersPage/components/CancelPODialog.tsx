import { AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatDateShort, formatNumberDecimal } from '@/utils/formatters';
import type { CancelPOPayload, PurchaseOrder, SupplierPaymentSummary } from '../types';
import { DepositOutcomeFields, useDepositOutcome } from './DepositOutcomeFields';

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

/**
 * ยกเลิกใบสั่งซื้อ (ก้อน 2 · กระดาน 4): ใบที่มีมัดจำค้างต้องบอกว่าได้เงินคืน (→ ธนาคารรับเข้า S11-1201, ส่วนที่ได้คืนไม่ครบ → S53-1105)
 * หรือไม่ได้คืน (→ S53-1105) ก่อนยกเลิก — คำตัดสินเจ้าของ 2026-10-05 ข้อ 6 · ใบที่ไม่เคยจ่ายเงินยกเลิกได้ทันทีเหมือนเดิม
 * ส่วนผลมัดจำใช้ร่วมกับ "ปิดใบ รับไม่ครบ" (DepositOutcomeFields — 2026-10-11)
 */
export function CancelPODialog({ open, po, summary, summaryLoading, pending, onClose, onConfirm }: CancelPODialogProps) {
  const outstanding = Number(summary?.depositOutstanding) || 0;
  const deposit = useDepositOutcome({ open, poId: po?.id, outstanding });
  const canConfirm = !pending && !summaryLoading && deposit.valid;

  if (!po) return null;
  const confirm = () => {
    if (!canConfirm) return;
    onConfirm(deposit.payload());
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
          {deposit.needsOutcome ? (
            <>
              <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-strong">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  ใบนี้จ่ายมัดจำไปแล้ว <span className="font-mono font-semibold tabular-nums">{money(outstanding)}</span> บาท{paidWhen ? ` (สั่งซื้อ ${paidWhen})` : ''} · ยังไม่รับของ —
                  ต้องระบุก่อนว่าได้เงินคืนหรือไม่ จึงจะยกเลิกได้
                </span>
              </div>
              <DepositOutcomeFields state={deposit} idPrefix="cancel" />
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
