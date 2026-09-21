import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CreditCard } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { cn } from '@/lib/utils';
import { formatDateShort, formatNumber, formatNumberDecimal } from '@/utils/formatters';
import type { ApprovePOPayload, POItem, PurchaseOrder } from '../types';
import { paymentStatusLabels } from '../constants';
import { getExpectedDateError } from '../po-dates.util';
import { fieldCls } from './wizard/chrome';
import {
  PaymentSection,
  isPaidStatus,
  paidAmountError,
  type PaymentFields,
  type SupplierPaymentMethod,
} from './wizard/PaymentSection';

export interface ApprovePODialogProps {
  open: boolean;
  po: PurchaseOrder | null;
  /** The supplier's terms from the suppliers list (the PO row only carries id/name/hasVat). */
  supplier?: { hasVat?: boolean; paymentMethods?: SupplierPaymentMethod[] };
  pending: boolean;
  onClose: () => void;
  /** "ปฏิเสธ…" — hands the PO to the existing reject-reason dialog. */
  onReject: (po: PurchaseOrder) => void;
  onConfirm: (payload: ApprovePOPayload) => void;
}

/** Same wording as the PO list rows (brand model storage color / accessory type brand model). */
export function poItemLabel(i: POItem): string {
  const parts =
    i.category === 'ACCESSORY'
      ? [i.accessoryType, i.accessoryBrand, i.model]
      : [i.brand, i.model, i.storage, i.color];
  return parts.filter(Boolean).join(' ');
}

function SectionTitle({ icon, tone, title, hint }: { icon: React.ReactNode; tone: string; title: string; hint: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <div className={cn('flex size-7 items-center justify-center rounded-md', tone)}>{icon}</div>
      <div>
        <h3 className="text-sm font-semibold leading-snug text-foreground">{title}</h3>
        <p className="text-xs leading-snug text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

const emptyPayment = (method: string): PaymentFields => ({
  paymentStatus: 'UNPAID',
  paymentMethod: method,
  paidAmount: '',
  paymentNotes: '',
});

/**
 * Approve = order + pay in one box (owner 2026-09-06). Replaces the bare "อนุมัติ PO …?" confirm:
 * ① สั่งซื้อ — confirm the expected date the branch manager typed; ② จ่ายเงิน — the same payment
 * block as the wizard's last step. The primary button says what will happen; leaving
 * "ยังไม่จ่าย" approves on credit and the due date from the supplier's terms is shown instead.
 * Plain buttons only — no submit type (see CreatePOModal for the mid-click type-flip bug).
 */
export function ApprovePODialog({ open, po, supplier, pending, onClose, onReject, onConfirm }: ApprovePODialogProps) {
  const defaultPm = supplier?.paymentMethods?.find((pm) => pm.isDefault) ?? supplier?.paymentMethods?.[0];
  const [expectedDate, setExpectedDate] = useState('');
  const [payment, setPayment] = useState<PaymentFields>(emptyPayment(''));
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attachmentUrl, setAttachmentUrl] = useState('');

  // Fresh form every time the dialog opens for a PO
  useEffect(() => {
    if (!open || !po) return;
    setExpectedDate(po.expectedDate ? po.expectedDate.slice(0, 10) : '');
    setPayment(emptyPayment(defaultPm?.paymentMethod ?? ''));
    setAttachments([]);
    setAttachmentUrl('');
    // defaultPm is derived from `supplier`, which can arrive a tick after `po` — key on its method only
  }, [open, po, defaultPm?.paymentMethod]);

  const netAmount = Number(po?.netAmount) || 0;
  const orderDate = po?.orderDate ? po.orderDate.slice(0, 10) : '';
  const expectedDateError = getExpectedDateError(orderDate, expectedDate);
  const paid = isPaidStatus(payment.paymentStatus);
  const amountError = paidAmountError(payment, netAmount);
  const pieces = useMemo(() => (po?.items ?? []).reduce((n, i) => n + i.quantity, 0), [po]);
  const creditPm = supplier?.paymentMethods?.find((pm) => pm.paymentMethod === (po?.paymentMethod || defaultPm?.paymentMethod));
  const creditDays = creditPm?.creditTermDays;

  if (!po) return null;

  const primaryLabel = paid
    ? `อนุมัติ · ${paymentStatusLabels[payment.paymentStatus] ?? payment.paymentStatus} ${formatNumber(Number(payment.paidAmount) || 0)} · สั่งซื้อ`
    : 'อนุมัติและสั่งซื้อ';
  const disabled = pending || !!expectedDateError || (paid && !!amountError);

  const confirm = () => {
    if (disabled) return;
    onConfirm({
      id: po.id,
      expectedDate: expectedDate || undefined,
      ...(paid
        ? {
            paymentStatus: payment.paymentStatus,
            paymentMethod: payment.paymentMethod || undefined,
            paidAmount: Number(payment.paidAmount),
            paymentNotes: payment.paymentNotes || undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
          }
        : {}),
    });
  };

  const unpaidNote = po.dueDate
    ? `ครบกำหนดชำระ ${formatDateShort(po.dueDate)}${creditDays ? ` (เครดิต ${creditDays} วัน)` : ''} — บันทึกการจ่ายทีหลังได้จากปุ่ม "จ่ายเงิน" ของใบนี้ หรือแท็บยอดค้างชำระ`
    : 'ผู้ขายไม่มีเครดิต — บันทึกการจ่ายทีหลังได้จากปุ่ม "จ่ายเงิน" ของใบนี้';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[calc(100vh-4rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="leading-snug">อนุมัติ {po.poNumber}</DialogTitle>
          <DialogDescription className="leading-snug">
            {po.createdBy?.name ?? 'ผู้สร้าง'} ขอซื้อจาก {po.supplier.name} · {po.items.length} รายการ · {pieces} ชิ้น · ยอดสุทธิ{' '}
            <span className="font-mono font-semibold tabular-nums text-foreground">{formatNumberDecimal(netAmount, 2)} บาท</span>
          </DialogDescription>
          <p className="truncate text-xs leading-snug text-muted-foreground" title={po.items.map(poItemLabel).join(' · ')}>
            {po.items.map((i) => `${poItemLabel(i)} × ${i.quantity}`).join(' · ')}
          </p>
        </DialogHeader>

        <div className="space-y-5">
          <section>
            <SectionTitle
              icon={<CalendarDays className="size-4" />}
              tone="bg-primary/10 text-primary"
              title="สั่งซื้อ"
              hint="อนุมัติแล้วถือว่าสั่งซื้อทันที — ยังยกเลิกได้ตราบใดที่ยังไม่รับของ"
            />
            <label htmlFor="approve-expected-date" className="mb-1 block text-xs leading-snug text-muted-foreground">
              วันที่คาดว่าจะได้รับ
            </label>
            <div className="max-w-xs">
              <ThaiDateInput
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                min={orderDate || undefined}
                aria-label="วันที่คาดว่าจะได้รับ"
                aria-invalid={expectedDateError ? true : undefined}
                className={cn(fieldCls, expectedDateError && 'border-destructive focus-visible:ring-destructive/30')}
              />
            </div>
            {expectedDateError ? (
              <p role="alert" className="mt-1 text-xs leading-snug text-destructive">
                {expectedDateError}
              </p>
            ) : (
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                {po.expectedDate
                  ? `${po.createdBy?.name ?? 'ผู้สร้าง'} ใส่ไว้ ${formatDateShort(po.expectedDate)} — แก้ได้ที่นี่ ใช้ขึ้นป้าย "เลยกำหนดส่ง" ถ้าของยังไม่มา`
                  : 'ยังไม่ระบุ — ใส่ได้ถ้ารู้ ใช้ขึ้นป้าย "เลยกำหนดส่ง" ถ้าของยังไม่มา'}
              </p>
            )}
          </section>

          <section>
            <SectionTitle
              icon={<CreditCard className="size-4" />}
              tone="bg-warning/10 text-warning-strong"
              title="จ่ายเงิน"
              hint='จ่ายตอนอนุมัติเลยก็บันทึกที่นี่ — ถ้าเป็นเครดิตปล่อย "ยังไม่จ่าย" แล้วค่อยบันทึกทีหลัง'
            />
            <PaymentSection
              variant="plain"
              idPrefix="approve"
              payment={payment}
              onChange={(patch) => setPayment((p) => ({ ...p, ...patch }))}
              netAmount={netAmount}
              paymentMethods={supplier?.paymentMethods}
              attachmentUrl={attachmentUrl}
              setAttachmentUrl={setAttachmentUrl}
              attachments={attachments}
              setAttachments={setAttachments}
              unpaidNote={unpaidNote}
            />
          </section>
        </div>

        <DialogFooter className="mt-2 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => onReject(po)}
            disabled={pending}
            className="text-sm font-medium text-destructive hover:underline disabled:opacity-50 sm:mr-auto"
          >
            ปฏิเสธ…
          </button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              ยกเลิก
            </Button>
            <Button type="button" onClick={confirm} disabled={disabled}>
              {pending ? 'กำลังอนุมัติ…' : primaryLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
