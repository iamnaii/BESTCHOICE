import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { getRequestCompany } from '@/lib/company-scope';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import DataTable, { type Column } from '@/components/ui/DataTable';
import { revealTableControl } from '@/components/ui/table-focus';
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
  type PaymentApprovalAction,
} from '@/hooks/usePaymentApprovalRequests';
import PaymentApprovalSummary, { paymentApprovalSummary } from './PaymentApprovalSummary';

type Decision = 'approve' | 'reject' | 'cancel';
type QueueView = Decision | 'review';
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
const amountLabels: Record<PaymentApprovalAction, string> = {
  RECORD_PAYMENT: 'ยอดรับชำระ',
  WAIVE_LATE_FEE: 'อนุโลมค่าปรับ',
  VOID_RECEIPT: 'ยอดใบเสร็จที่ยกเลิก',
  EARLY_PAYOFF: 'ยอดปิดสัญญา',
};

/** Authorization comes from the current user's server-calculated canApprove result. */
export default function PaymentApprovalQueue({ contractId }: { contractId?: string }) {
  const { user } = useAuth();
  const scope = getRequestCompany();
  const invalidate = usePaymentApprovalCache();
  const openerRef = useRef<HTMLElement | null>(null);
  const queueRef = useRef<HTMLElement | null>(null);
  const [selected, setSelected] = useState<{
    request: PaymentApprovalRequest;
    decision: QueueView;
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
        selected && selected.decision !== 'review'
          ? `${decisionLabels[selected.decision]}คำขอสำเร็จ`
          : 'ดำเนินการสำเร็จ',
      );
      openerRef.current = null;
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
  const openDecision = useCallback((request: PaymentApprovalRequest, decision: QueueView, opener?: HTMLElement) => {
    if (opener) openerRef.current = opener;
    decide.reset();
    setReason(decision === 'approve' && request.requestedById === user?.id ? request.reason : '');
    setSelected({ request, decision });
  }, [decide.reset, user?.id]);
  const columns = useMemo<Column<PaymentApprovalRequest>[]>(() => [
    {
      key: 'contract', label: 'สัญญา / รายการ',
      render: (request) => (
        <div className="max-w-60 space-y-1 leading-snug [overflow-wrap:anywhere]">
          <div className="font-medium text-primary">{request.contractNumber ?? 'ไม่ระบุเลขสัญญา'}</div>
          <div className="text-xs text-muted-foreground">
            {PAYMENT_APPROVAL_ACTION_LABELS[request.action] ?? request.action}
          </div>
        </div>
      ),
    },
    {
      key: 'amount', label: 'ยอดเงิน', align: 'right',
      render: (request) => {
        const amount = paymentApprovalSummary(
          { ...request.payload, ...request.reviewSummary }, request.action,
        ).find((field) => field.label === amountLabels[request.action]);
        return <div className="space-y-1 leading-snug">
          <div className="whitespace-nowrap font-semibold tabular-nums">{amount?.value ?? '—'}</div>
          <div className="text-xs text-muted-foreground">{amountLabels[request.action]}</div>
        </div>;
      },
    },
    {
      key: 'requester', label: 'ผู้ขอ / วันที่',
      render: (request) => (
        <div className="max-w-44 space-y-1 leading-snug [overflow-wrap:anywhere]">
          <div>{request.requestedByName ?? 'ไม่ระบุชื่อ'}</div>
          <div className="text-xs text-muted-foreground">{formatThaiDateShort(request.createdAt)}</div>
        </div>
      ),
    },
    {
      key: 'reason', label: 'เหตุผล',
      render: (request) => <p className="line-clamp-2 max-w-80 whitespace-pre-wrap leading-snug [overflow-wrap:anywhere]">{request.reason}</p>,
    },
    {
      key: 'actions', label: 'ตรวจสอบ', align: 'right', stickyRight: true,
      render: (request) => (
        <div className="space-y-1">
          <Button type="button" variant="outline" onClick={(event) => openDecision(request, 'review', event.currentTarget)}>ตรวจคำขอ</Button>
          {!request.canApprove && <p className="text-xs text-muted-foreground leading-snug">รอผู้มีสิทธิ์อนุมัติ</p>}
        </div>
      ),
    },
  ], [openDecision]);
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
    <section ref={queueRef} tabIndex={-1} className="space-y-4" aria-label="คิวอนุมัติการรับชำระ">
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
          <div onFocusCapture={revealTableControl}>
            <DataTable
              columns={columns}
              data={rows}
              responsive={false}
              minWidth="48rem"
              density="compact"
              scrollLabel="ตารางคำขออนุมัติการรับชำระ"
              className="[&_th]:text-[13px] [&_th]:tracking-normal [&_th]:whitespace-nowrap [&_td]:text-sm [&_button]:scroll-mt-20 [&_button]:scroll-mb-[calc(5rem+env(safe-area-inset-bottom))]"
            />
          </div>
        )}
      </QueryBoundary>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !decide.isPending) setSelected(null);
        }}
      >
        <DialogContent
          showCloseButton={!decide.isPending}
          className="max-h-[calc(100dvh-2rem)] overflow-hidden [@media(max-height:600px)]:overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (openerRef.current?.isConnected ? openerRef.current : queueRef.current)?.focus();
          }}
        >
          <DialogHeader className="shrink-0 text-left">
            <DialogTitle>{selected?.decision === 'review' ? 'ตรวจคำขอ' : `${selected ? decisionLabels[selected.decision] : ''}คำขอ`}</DialogTitle>
            <DialogDescription className="leading-snug">
              {selected?.request.contractNumber} ·{' '}
              {selected && PAYMENT_APPROVAL_ACTION_LABELS[selected.request.action]}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain [overflow-wrap:anywhere] [@media(max-height:600px)]:shrink-0 [@media(max-height:600px)]:overflow-visible">
              <PaymentApprovalSummary
                action={selected.request.action}
                payload={{ ...selected.request.payload, ...selected.request.reviewSummary }}
              />
              <p className="whitespace-pre-wrap break-words text-sm leading-snug">
                <span className="text-muted-foreground">เหตุผลที่ขอ: </span>
                {selected.request.reason}
              </p>
              <div className="space-y-1 text-xs text-muted-foreground leading-snug [overflow-wrap:anywhere]">
                <p>ผู้ขอ: {selected.request.requestedByName ?? 'ไม่ระบุชื่อ'} · {formatThaiDateShort(selected.request.createdAt)}</p>
                <p>สถานะ: {statusLabels[currentRequest?.status ?? selected.request.status] ?? selected.request.status}</p>
                <p>สิทธิ์ที่ต้องใช้: {selected.request.requiredPermissions.map((permission) =>
                  PAYMENT_APPROVAL_PERMISSION_LABELS[permission as keyof typeof PAYMENT_APPROVAL_PERMISSION_LABELS] ?? permission,
                ).join(' · ') || 'ตามรายการ'}</p>
              </div>
              {selected.decision !== 'review' && selected.decision !== 'cancel' && (
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
              {selected.decision !== 'review' && !decisionAllowed && (
                <p role="alert" className="text-sm text-destructive leading-snug">
                  สถานะคำขอหรือสิทธิ์เปลี่ยนแล้ว กรุณาปิดหน้าต่างและตรวจรายการอีกครั้ง
                </p>
              )}
            </div>
          )}
          <DialogFooter className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:space-x-0 [&>*:only-child]:col-span-2">
            {selected?.decision === 'review' ? (
              <>
                <Button
                  variant="outline"
                  className={currentRequest?.canApprove && currentRequest.requestedById !== user?.id ? 'col-span-2 sm:col-span-1' : undefined}
                  onClick={() => setSelected(null)}
                >กลับรายการ</Button>
                {currentRequest && isPending(currentRequest) && (
                  <>
                    {currentRequest.requestedById === user?.id && (
                      <Button variant="outline" onClick={() => openDecision(currentRequest, 'cancel')}>ยกเลิกคำขอ</Button>
                    )}
                    {currentRequest.canApprove && (
                      <>
                        <Button variant="outline" onClick={() => openDecision(currentRequest, 'reject')}>ปฏิเสธ</Button>
                        <Button onClick={() => openDecision(currentRequest, 'approve')}>อนุมัติ</Button>
                      </>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <Button variant="outline" disabled={decide.isPending} onClick={() => selected && openDecision(selected.request, 'review')}>
                  กลับ
                </Button>
                <Button
                  disabled={decide.isPending || !decisionAllowed || (!!reasonRequired && !reason.trim())}
                  onClick={() => {
                    if (selected && selected.decision !== 'review') {
                      decide.mutate({ request: selected.request, decision: selected.decision, reason });
                    }
                  }}
                >
                  {decide.isPending ? 'กำลังดำเนินการ...' : 'ยืนยัน'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
