import { useEffect, useId, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/api';
import { PAYMENT_APPROVAL_PERMISSION_LABELS } from '@/lib/payment-approval-permissions';
import {
  PAYMENT_APPROVAL_ACTION_LABELS,
  useCreatePaymentApprovalRequest,
  type PaymentApprovalAction,
  type PaymentApprovalRequest,
} from '@/hooks/usePaymentApprovalRequests';
import PaymentApprovalSummary from './PaymentApprovalSummary';

export interface PaymentApprovalRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: PaymentApprovalAction;
  targetId: string;
  /** Caller passes the complete payload snapshot that is being submitted for approval. */
  payload: Record<string, unknown>;
  contractNumber?: string;
  description?: string;
  requiredPermissions?: string[];
  initialReason?: string;
  onRequested?: (request: PaymentApprovalRequest) => void;
}

export default function PaymentApprovalRequestDialog({
  open,
  onOpenChange,
  action,
  targetId,
  payload,
  contractNumber,
  description,
  requiredPermissions = [],
  initialReason = '',
  onRequested,
}: PaymentApprovalRequestDialogProps) {
  const [reason, setReason] = useState(initialReason);
  const reasonId = useId();
  const createRequest = useCreatePaymentApprovalRequest();
  useEffect(() => {
    if (open) {
      setReason(initialReason);
      createRequest.reset();
    }
    // Reset only when opening or changing the requested target, not when typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, action, targetId, initialReason]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!createRequest.isPending) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={!createRequest.isPending}>
        <DialogHeader>
          <DialogTitle>ส่งคำขออนุมัติ</DialogTitle>
          <DialogDescription className="leading-snug">
            {PAYMENT_APPROVAL_ACTION_LABELS[action]}
            {contractNumber ? ` · ${contractNumber}` : ''} — ผู้มีสิทธิ์จะตรวจรายการผ่านคิวอนุมัติ
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {description && (
            <p className="text-sm text-muted-foreground leading-snug">{description}</p>
          )}
          <PaymentApprovalSummary action={action} payload={payload} />
          {requiredPermissions.length > 0 && (
            <p className="text-xs text-muted-foreground leading-snug">
              สิทธิ์ที่ต้องใช้:{' '}
              {requiredPermissions
                .map(
                  (permission) =>
                    PAYMENT_APPROVAL_PERMISSION_LABELS[
                      permission as keyof typeof PAYMENT_APPROVAL_PERMISSION_LABELS
                    ] ?? permission,
                )
                .join(' · ')}
            </p>
          )}
          <div className="space-y-2">
            <label htmlFor={reasonId} className="text-sm font-medium leading-snug">
              เหตุผลที่ขออนุมัติ <span className="text-destructive">*</span>
            </label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              disabled={createRequest.isPending}
              maxLength={1000}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-snug"
            />
          </div>
          {createRequest.isError && (
            <p role="alert" className="text-sm text-destructive leading-snug">
              {getErrorMessage(createRequest.error)}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={createRequest.isPending}
            onClick={() => onOpenChange(false)}
          >
            ยกเลิก
          </Button>
          <Button
            disabled={!reason.trim() || !targetId || createRequest.isPending}
            onClick={() => {
              createRequest.mutate(
                { action, targetId, reason, payload },
                {
                  onSuccess: (request) => {
                    onRequested?.(request);
                    onOpenChange(false);
                  },
                },
              );
            }}
          >
            {createRequest.isPending ? 'กำลังส่ง...' : 'ส่งคำขออนุมัติ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
