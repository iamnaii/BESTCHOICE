import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  REJECT_REASON_MAX,
  REJECT_REASON_MIN,
  type DeviceReturnRow,
  type CloseDeviceReturnResponse,
} from './types';

/**
 * ส่งกลับใบรับเครื่องคืน (spec 2026-09-20 §5.3) — OWNER/FINANCE_MANAGER:
 * `POST /device-returns/:id/reject { reason }` (10–500). VOLUNTARY: สัญญากลับ
 * `previousContractStatus`; REPOSSESSION: สัญญายัง TERMINATED. ลูกค้าได้ไลน์
 * `DEVICE_RETURN_CANCELED`. ใช้ร่วมกันโดย DeviceReturnList และ RepossessionOverlay.
 */
interface Props {
  target: Pick<DeviceReturnRow, 'id' | 'docNumber' | 'returnKind' | 'contract'> | null;
  onClose: () => void;
  onRejected?: () => void;
}

export function RejectDeviceReturnDialog({ target, onClose, onRejected }: Props) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const submitting = useRef(false);
  const session = useRef(0);

  // เปิดใบใหม่ = เริ่มเหตุผลว่างเสมอ
  useEffect(() => {
    setReason('');
    session.current += 1;
  }, [target?.id]);

  const trimmed = reason.trim();
  const tooShort = trimmed.length < REJECT_REASON_MIN;
  const tooLong = trimmed.length > REJECT_REASON_MAX;

  const mutation = useMutation({
    retry: false,
    mutationFn: async (submitted: {
      target: NonNullable<Props['target']>;
      reason: string;
      session: number;
    }) =>
      (
        await api.post<CloseDeviceReturnResponse>(`/device-returns/${submitted.target.id}/reject`, {
          reason: submitted.reason,
        })
      ).data,
    onSuccess: (result, submitted) => {
      // The server may close the intake without restoring an independently changed contract.
      toast.success(`ส่งกลับใบ ${submitted.target.docNumber} แล้ว`, {
        description: result.notice?.trim() || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['device-returns'] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['contract', submitted.target.contract.id] });
      queryClient.invalidateQueries({ queryKey: ['customer-tags'] });
      // A parent can switch/close the target during a request; do not close its new dialog.
      if (session.current === submitted.session) {
        onRejected?.();
        onClose();
      }
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
    onSettled: () => {
      submitting.current = false;
    },
  });

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && !submitting.current && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ส่งกลับใบรับเครื่องคืน</DialogTitle>
          <DialogDescription className="leading-snug">
            ใบ <span className="font-semibold">{target?.docNumber ?? ''}</span> สัญญา{' '}
            <span className="font-semibold">{target?.contract.contractNumber ?? ''}</span> —
            ระบุเหตุผล ให้สาขา ({REJECT_REASON_MIN}–{REJECT_REASON_MAX} ตัวอักษร)
            {' — ลูกค้าจะได้รับไลน์แจ้งว่าใบถูกยกเลิก'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="device-return-reject-reason">
            เหตุผลที่ส่งกลับ <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="device-return-reject-reason"
            rows={3}
            maxLength={REJECT_REASON_MAX}
            value={reason}
            disabled={mutation.isPending}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น ราคาประเมินไม่สอดคล้องสภาพเครื่อง / ใบผิดสัญญา"
          />
          {reason.length > 0 && tooShort && (
            <p className="text-xs text-destructive leading-snug">
              ต้องอย่างน้อย {REJECT_REASON_MIN} ตัวอักษร
            </p>
          )}
          <p className="text-xs text-muted-foreground leading-snug">
            ถ้าใบข้ามเดือน งวดบัญชีเดือนก่อนอาจปิดแล้ว — accrual ย้อนหลังของงวดที่ค้างระหว่างรอ
            ต้องเปิดงวดก่อน (PERIOD_REOPENED)
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            ยกเลิก
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (!target || tooShort || tooLong || submitting.current) return;
              submitting.current = true;
              mutation.mutate({ target, reason: trimmed, session: session.current });
            }}
            disabled={!target || tooShort || tooLong || mutation.isPending}
          >
            {mutation.isPending ? 'กำลังส่งกลับ...' : 'ยืนยันส่งกลับ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
