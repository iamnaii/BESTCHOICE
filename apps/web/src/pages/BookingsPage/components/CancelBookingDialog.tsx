import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { Booking } from '../types';
import { fmtMoneyShort } from '../utils';
import { METHOD_LABEL } from './BookingTimeline';

const REASONS = [
  'ลูกค้าเปลี่ยนใจ',
  'ไม่ผ่านเครดิต',
  'เครื่องถูกขายไปก่อน',
  'เปลี่ยนรุ่น/สี',
] as const;
export const CANCEL_REASON_MIN = 3;

/** กล่อง 4B: บอกยอดคืน + ช่องทาง "ตามที่รับมา" + เหตุผลบังคับ (เดิมกดแล้วคืนเงินทันทีไม่มีถาม) */
export default function CancelBookingDialog({
  booking,
  open,
  onOpenChange,
  onConfirm,
  loading,
}: {
  booking: Pick<
    Booking,
    'id' | 'bookingNumber' | 'status' | 'depositAmount' | 'depositMethod'
  > | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  loading?: boolean;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open, booking?.id]);
  const refund = booking?.status === 'PAID' ? Number(booking.depositAmount) : 0;
  const method = METHOD_LABEL[booking?.depositMethod ?? ''] ?? 'วิธีที่รับมา';
  const description =
    refund > 0
      ? `ระบบจะคืนมัดจำ ${fmtMoneyShort(refund)} บาท ให้ลูกค้าเต็มจำนวนตามวิธีที่รับมา (${method}) และบันทึกการคืนเงินในสมุดเงินหน้าร้านของวันนี้ ใบจองนี้จะปิดถาวร ถ้าลูกค้ากลับมาต้องออกใบจองใหม่`
      : 'ใบจองนี้ยังไม่ได้รับมัดจำ จะปิดใบโดยไม่มีการคืนเงิน ถ้าลูกค้ากลับมาต้องออกใบจองใหม่';
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`ยกเลิกใบจอง ${booking?.bookingNumber ?? ''}?`}
      description={description}
      variant="destructive"
      confirmLabel={
        refund > 0 ? `ยืนยันยกเลิกและคืนมัดจำ ${fmtMoneyShort(refund)}` : 'ยืนยันยกเลิกใบจอง'
      }
      confirmDisabled={reason.trim().length < CANCEL_REASON_MIN}
      loading={loading}
      closeOnConfirm={false}
      onConfirm={() => onConfirm(reason.trim())}
    >
      <div className="space-y-2">
        <Label htmlFor="cancel-reason">เหตุผล (บังคับ)</Label>
        <div className="flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reason === r}
              onClick={() => setReason(r)}
              className={cn(
                'inline-flex h-8 items-center rounded-full border px-3 text-[13px] leading-snug',
                reason === r
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-card hover:bg-muted',
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <Input
          id="cancel-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="อย่างน้อย 3 ตัวอักษร"
        />
      </div>
    </ConfirmDialog>
  );
}
