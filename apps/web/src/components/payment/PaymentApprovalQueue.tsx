import { useId, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { getRequestCompany } from '@/lib/company-scope';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatThaiDateShort } from '@/lib/date';
import { PAYMENT_APPROVAL_PERMISSION_LABELS } from '@/lib/payment-approval-permissions';
import {
  PAYMENT_APPROVAL_ACTION_LABELS,
  usePaymentApprovalCache,
  type PaymentApprovalRequest,
} from '@/hooks/usePaymentApprovalRequests';
import PaymentApprovalSummary from './PaymentApprovalSummary';

type Decision = 'approve' | 'reject' | 'cancel';
const decisionLabels: Record<Decision, string> = {
  approve: 'อนุมัติ',
  reject: 'ปฏิเสธ',
  cancel: 'ยกเลิก',
};
const statusLabels: Record<string, string> = {
  PENDING: 'รออนุมัติ',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  EXECUTED: 'ดำเนินการแล้ว',
  REJECTED: 'ปฏิเสธแล้ว',
  CANCELLED: 'ยกเลิกแล้ว',
};
const isPending = (request: PaymentApprovalRequest) =>
  ['PENDING', 'PENDING_APPROVAL'].includes(request.status);

/** Authorization comes from the current user's server-calculated canApprove result. */
export default function PaymentApprovalQueue({ contractId }: { contractId?: string }) {
  const { user } = useAuth();
  const scope = getRequestCompany();
  const invalidate = usePaymentApprovalCache();
  const [selected, setSelected] = useState<{
    request: PaymentApprovalRequest;
    decision: Decision;
  } | null>(null);
  const [reason, setReason] = useState('');
  const reasonId = useId();
  const query = useQuery({
    queryKey: ['payment-approval-requests', user?.id, scope, contractId],
    queryFn: async () =>
      (
        await api.get<{ data: PaymentApprovalRequest[] }>('/payments/approval-requests', {
          params: { contractId },
        })
      ).data.data,
    enabled: !!user,
    staleTime: 0,
  });
  const decide = useMutation({
    mutationFn: async ({
      request,
      decision,
      reason: decisionReason,
    }: {
      request: PaymentApprovalRequest;
      decision: Decision;
      reason: string;
    }) => {
      const body = decision === 'cancel' ? {} : { reason: decisionReason.trim() || undefined };
      return (await api.post(`/payments/approval-requests/${request.id}/${decision}`, body)).data;
    },
    onSuccess: () => {
      toast.success(
        selected ? `${decisionLabels[selected.decision]}คำขอสำเร็จ` : 'ดำเนินการสำเร็จ',
      );
      setSelected(null);
      invalidate();
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
      // Another reviewer may have acted or permissions may have changed while open.
      query.refetch();
    },
  });
  const rows = (query.data ?? []).filter(
    (request) => (!contractId || request.contractId === contractId) && isPending(request),
  );
  const openDecision = (request: PaymentApprovalRequest, decision: Decision) => {
    decide.reset();
    setReason(decision === 'approve' && request.requestedById === user?.id ? request.reason : '');
    setSelected({ request, decision });
  };
  const ownerSelfApproval =
    selected?.decision === 'approve' &&
    user?.role === 'OWNER' &&
    selected.request.requestedById === user.id;
  const reasonRequired = selected?.decision === 'reject' || ownerSelfApproval;
  // Re-read the refreshed row rather than retaining stale permission/status from the opened dialog.
  const currentRequest = selected
    ? query.data?.find((request) => request.id === selected.request.id)
    : undefined;
  const decisionAllowed =
    !!currentRequest &&
    isPending(currentRequest) &&
    (selected?.decision === 'cancel'
      ? currentRequest.requestedById === user?.id
      : currentRequest.canApprove);

  return (
    <section className="space-y-4" aria-label="คิวอนุมัติการรับชำระ">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold leading-snug">คำขออนุมัติการรับชำระ</h2>
          <p className="text-sm text-muted-foreground leading-snug">
            ตรวจยอดและเหตุผลตามรายการที่ผู้ขอส่งไว้
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            aria-label="รีเฟรชคำขออนุมัติ"
          >
            <RefreshCw className="size-4" />
            รีเฟรช
          </Button>
        </div>
      </div>
      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={query.refetch}
      >
        {rows.length === 0 ? (
          <p className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground leading-snug">
            ไม่มีคำขอที่รออนุมัติ
          </p>
        ) : (
          <div className="grid gap-3">
            {rows.map((request) => (
              <article
                key={request.id}
                className="rounded-xl border border-border bg-card p-4"
                aria-label={`คำขอ ${request.contractNumber ?? request.id}`}
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <h3 className="font-medium leading-snug">
                      {PAYMENT_APPROVAL_ACTION_LABELS[request.action] ?? request.action}
                    </h3>
                    <p className="font-mono text-sm text-muted-foreground">
                      {request.contractNumber ?? 'ไม่ระบุเลขสัญญา'}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground leading-snug">
                    {statusLabels[request.status] ?? request.status}
                  </span>
                </div>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <PaymentApprovalSummary
                    action={request.action}
                    payload={{ ...request.payload, ...request.reviewSummary }}
                  />
                  <div className="space-y-1 text-sm leading-snug">
                    <p>
                      <span className="text-muted-foreground">ผู้ขอ: </span>
                      {request.requestedByName ?? 'ไม่ระบุชื่อ'} ·{' '}
                      {formatThaiDateShort(request.createdAt)}
                    </p>
                    <p className="whitespace-pre-wrap break-words">
                      <span className="text-muted-foreground">เหตุผล: </span>
                      {request.reason}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      สิทธิ์ที่ต้องใช้:{' '}
                      {request.requiredPermissions
                        .map(
                          (permission) =>
                            PAYMENT_APPROVAL_PERMISSION_LABELS[
                              permission as keyof typeof PAYMENT_APPROVAL_PERMISSION_LABELS
                            ] ?? permission,
                        )
                        .join(' · ') || 'ตามรายการ'}
                    </p>
                  </div>
                </div>
                {isPending(request) && (
                  <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                    {!request.canApprove && (
                      <p className="mr-auto text-xs text-muted-foreground leading-snug">
                        รอผู้มีสิทธิ์อนุมัติรายการนี้
                      </p>
                    )}
                    {request.requestedById === user?.id && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openDecision(request, 'cancel')}
                      >
                        ยกเลิกคำขอ
                      </Button>
                    )}
                    {request.canApprove && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openDecision(request, 'reject')}
                        >
                          ปฏิเสธ
                        </Button>
                        <Button size="sm" onClick={() => openDecision(request, 'approve')}>
                          อนุมัติ
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </QueryBoundary>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !decide.isPending) setSelected(null);
        }}
      >
        <DialogContent showCloseButton={!decide.isPending}>
          <DialogHeader>
            <DialogTitle>{selected ? decisionLabels[selected.decision] : ''}คำขอ</DialogTitle>
            <DialogDescription className="leading-snug">
              {selected?.request.contractNumber} ·{' '}
              {selected && PAYMENT_APPROVAL_ACTION_LABELS[selected.request.action]}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <PaymentApprovalSummary
                action={selected.request.action}
                payload={{ ...selected.request.payload, ...selected.request.reviewSummary }}
              />
              <p className="whitespace-pre-wrap text-sm leading-snug">
                <span className="text-muted-foreground">เหตุผลที่ขอ: </span>
                {selected.request.reason}
              </p>
              {selected.decision !== 'cancel' && (
                <div className="space-y-2">
                  {ownerSelfApproval && (
                    <p className="text-sm text-muted-foreground leading-snug">
                      คุณกำลังอนุมัติคำขอของตนเองในสิทธิ์เจ้าของ กรุณายืนยันเหตุผลเพื่อบันทึกประวัติ
                    </p>
                  )}
                  <label htmlFor={reasonId} className="text-sm font-medium leading-snug">
                    เหตุผล{reasonRequired ? ' *' : ' (ไม่บังคับ)'}
                  </label>
                  <textarea
                    id={reasonId}
                    rows={3}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    disabled={decide.isPending}
                    maxLength={1000}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-snug"
                  />
                </div>
              )}
              {decide.isError && (
                <p role="alert" className="text-sm text-destructive leading-snug">
                  {getErrorMessage(decide.error)}
                </p>
              )}
              {!decisionAllowed && (
                <p role="alert" className="text-sm text-destructive leading-snug">
                  สถานะคำขอหรือสิทธิ์เปลี่ยนแล้ว กรุณาปิดหน้าต่างและตรวจรายการอีกครั้ง
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={decide.isPending} onClick={() => setSelected(null)}>
              กลับ
            </Button>
            <Button
              disabled={
                decide.isPending || !decisionAllowed || (!!reasonRequired && !reason.trim())
              }
              onClick={() => {
                if (selected) decide.mutate({ ...selected, reason });
              }}
            >
              {decide.isPending ? 'กำลังดำเนินการ...' : 'ยืนยัน'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
