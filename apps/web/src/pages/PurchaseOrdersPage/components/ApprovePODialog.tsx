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
import { formatDateShort, formatNumberDecimal } from '@/utils/formatters';
import type { ApprovePOPayload, POItem, PurchaseOrder } from '../types';
import { getExpectedDateError } from '../po-dates.util';
import { fieldCls } from './wizard/chrome';
import type { SupplierPaymentMethod } from './wizard/PaymentSection';

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

/**
 * Approve = order (owner 2026-09-06): confirm the expected date the branch manager typed, then the PO is
 * ORDERED at once. ก้อน 2 (คำตัดสินเจ้าของ 2026-10-05): การจ่ายเงินถูกถอดออกจากกล่องนี้ — ทุกการจ่ายผ่านปุ่ม
 * "บันทึกการจ่าย" ในใบหลังอนุมัติ เพื่อให้ลงบัญชีทุกครั้ง (API ปฏิเสธยอดจ่ายตอนอนุมัติ).
 * Plain buttons only — no submit type (see CreatePOModal for the mid-click type-flip bug).
 */
export function ApprovePODialog({ open, po, supplier, pending, onClose, onReject, onConfirm }: ApprovePODialogProps) {
  const defaultPm = supplier?.paymentMethods?.find((pm) => pm.isDefault) ?? supplier?.paymentMethods?.[0];
  const [expectedDate, setExpectedDate] = useState('');

  // Fresh form every time the dialog opens for a PO
  useEffect(() => {
    if (!open || !po) return;
    setExpectedDate(po.expectedDate ? po.expectedDate.slice(0, 10) : '');
  }, [open, po]);

  const netAmount = Number(po?.netAmount) || 0;
  const orderDate = po?.orderDate ? po.orderDate.slice(0, 10) : '';
  const expectedDateError = getExpectedDateError(orderDate, expectedDate);
  const pieces = useMemo(() => (po?.items ?? []).reduce((n, i) => n + i.quantity, 0), [po]);
  const creditPm = supplier?.paymentMethods?.find((pm) => pm.paymentMethod === (po?.paymentMethod || defaultPm?.paymentMethod));
  const creditDays = creditPm?.creditTermDays;

  if (!po) return null;

  const disabled = pending || !!expectedDateError;

  const confirm = () => {
    if (disabled) return;
    onConfirm({ id: po.id, expectedDate: expectedDate || undefined });
  };

  const paymentNote = po.dueDate
    ? `ครบกำหนดชำระ ${formatDateShort(po.dueDate)}${creditDays ? ` (เครดิต ${creditDays} วัน)` : ''} — บันทึกการจ่ายได้จากปุ่ม "บันทึกการจ่าย" ในใบนี้หลังอนุมัติ (ลงบัญชีทุกครั้ง · โอนธนาคารเท่านั้น)`
    : 'ผู้ขายไม่มีเครดิต — บันทึกการจ่ายได้จากปุ่ม "บันทึกการจ่าย" ในใบนี้หลังอนุมัติ (ลงบัญชีทุกครั้ง · โอนธนาคารเท่านั้น)';

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
              hint="จ่ายแยกหลังอนุมัติ — ทุกการจ่ายลงบัญชีผ่านปุ่มบันทึกการจ่ายในใบ"
            />
            <p className="text-xs leading-snug text-muted-foreground">{paymentNote}</p>
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
              {pending ? 'กำลังอนุมัติ…' : 'อนุมัติและสั่งซื้อ'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
