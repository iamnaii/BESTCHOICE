import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatDateMedium } from '@/utils/formatters';

interface PendingExchangeRequest {
  id: string;
  createdAt: string;
  conditionNote: string | null;
  mode: 'MEMO' | 'PRICED';
  approvalTier: 'AUTO' | 'REVIEW' | 'ESCALATE' | null;
  buybackPrice: string | null;
  oldContract: {
    id: string;
    contractNumber: string;
    customer: { id: string; name: string; phone: string };
  };
  oldProduct: { id: string; brand: string; model: string; storage: string | null; imeiSerial: string | null };
  newProduct: { id: string; brand: string; model: string; storage: string | null; imeiSerial: string | null };
  requestedBy: { id: string; name: string };
}

interface RecentExchangeRequest {
  id: string;
  mode: 'MEMO' | 'PRICED';
  memoAppliedAt: string | null;
  oldContract: {
    id: string;
    contractNumber: string;
    exchangedAt: string | null;
    customer: { name: string };
  };
  newContract: { id: string; contractNumber: string; status: string } | null;
}

type ActionTarget = {
  id: string;
  contractNumber: string;
  action: 'approve' | 'reject';
  mode: 'MEMO' | 'PRICED';
};

type CancelTarget = {
  id: string;
  contractNumber: string;
  diffDays: number;
  mode: 'MEMO' | 'PRICED';
};

function productLabel(p: PendingExchangeRequest['oldProduct']): string {
  const parts = [p.brand, p.model, p.storage].filter(Boolean).join(' ');
  return parts || '—';
}

/** วันที่ใช้อ้างอิงการเปลี่ยนเครื่อง — exchangedAt (PRICED) หรือ memoAppliedAt (MEMO) */
function exchangeDate(item: RecentExchangeRequest): string | null {
  return item.oldContract.exchangedAt ?? item.memoAppliedAt;
}

/** จำนวนวันปฏิทินนับจาก exchangeDate ถึงตอนนี้ (client-side approximation) */
function diffDaysFrom(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const from = new Date(dateStr);
  const now = new Date();
  const ms = now.setHours(0, 0, 0, 0) - new Date(from).setHours(0, 0, 0, 0);
  return Math.round(ms / 86_400_000);
}

export default function ExchangeRequestsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [target, setTarget] = useState<ActionTarget | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [memoAddendumSigned, setMemoAddendumSigned] = useState(false);
  const [memoMdmSwapped, setMemoMdmSwapped] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const {
    data: requests,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<PendingExchangeRequest[]>({
    queryKey: ['exchange-requests-pending'],
    queryFn: async () => (await api.get('/insurance/exchange-requests/pending')).data,
  });

  const {
    data: recentRequests,
    isLoading: isRecentLoading,
    isError: isRecentError,
    error: recentError,
    refetch: refetchRecent,
  } = useQuery<RecentExchangeRequest[]>({
    queryKey: ['exchange-requests-recent'],
    queryFn: async () => (await api.get('/insurance/exchange-requests/recent')).data,
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { memoAddendumSigned?: boolean; memoMdmSwapped?: boolean } }) =>
      api.post(`/insurance/exchange-requests/${id}/approve`, body),
    onSuccess: (response) => {
      // SP2 sign-then-activate (option B): approve() now produces a DRAFT
      // new contract. Customer must sign + OWNER/BM/FM must activate before
      // the JE chain fires. Jump straight to the new contract detail page
      // so the operator can collect signatures + click "เปิดใช้สัญญา".
      // MEMO mode has no new contract — newContractId stays null, skip navigate.
      const newContractId = response.data?.newContractId;
      toast.success(
        newContractId
          ? 'อนุมัติแล้ว — กรุณาให้ลูกค้าลงนามและกดเปิดใช้สัญญา'
          : 'อนุมัติแล้ว — เปลี่ยนเครื่องสำเร็จ',
      );
      queryClient.invalidateQueries({ queryKey: ['exchange-requests-pending'] });
      queryClient.invalidateQueries({ queryKey: ['exchange-requests-recent'] });
      setTarget(null);
      setMemoAddendumSigned(false);
      setMemoMdmSwapped(false);
      if (newContractId) {
        navigate(`/contracts/${newContractId}`);
      }
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/insurance/exchange-requests/${id}/reject`, { reason }),
    onSuccess: () => {
      toast.success('ปฏิเสธคำขอเปลี่ยนเครื่องแล้ว');
      queryClient.invalidateQueries({ queryKey: ['exchange-requests-pending'] });
      setTarget(null);
      setRejectReason('');
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/insurance/exchange-requests/${id}/cancel`, { reason }),
    onSuccess: (response) => {
      const penaltyAmount = response.data?.penaltyAmount;
      toast.success(penaltyAmount ? `ยกเลิกแล้ว — ค่าปรับ ฿${penaltyAmount}` : 'ยกเลิกแล้ว');
      queryClient.invalidateQueries({ queryKey: ['exchange-requests-pending'] });
      queryClient.invalidateQueries({ queryKey: ['exchange-requests-recent'] });
      setCancelTarget(null);
      setCancelReason('');
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const handleApprove = (item: PendingExchangeRequest) => {
    setMemoAddendumSigned(false);
    setMemoMdmSwapped(false);
    setTarget({
      id: item.id,
      contractNumber: item.oldContract.contractNumber,
      action: 'approve',
      mode: item.mode,
    });
  };

  const handleReject = (item: PendingExchangeRequest) => {
    setRejectReason('');
    setTarget({
      id: item.id,
      contractNumber: item.oldContract.contractNumber,
      action: 'reject',
      mode: item.mode,
    });
  };

  const handleApproveConfirm = () => {
    if (!target) return;
    approveMutation.mutate({ id: target.id, body: {} });
  };

  const handleMemoApproveConfirm = () => {
    if (!target || !memoAddendumSigned || !memoMdmSwapped) return;
    approveMutation.mutate({
      id: target.id,
      body: { memoAddendumSigned: true, memoMdmSwapped: true },
    });
  };

  const handleRejectConfirm = () => {
    if (!target || rejectReason.trim().length < 10) return;
    rejectMutation.mutate({ id: target.id, reason: rejectReason });
  };

  const handleCancelRequest = (item: RecentExchangeRequest) => {
    const dDays = diffDaysFrom(exchangeDate(item)) ?? 0;
    setCancelReason('');
    setCancelTarget({
      id: item.id,
      contractNumber: item.oldContract.contractNumber,
      diffDays: dDays,
      mode: item.mode,
    });
  };

  const handleCancelConfirm = () => {
    if (!cancelTarget || cancelReason.trim().length < 10) return;
    cancelMutation.mutate({ id: cancelTarget.id, reason: cancelReason });
  };

  const isMutating = approveMutation.isPending || rejectMutation.isPending;

  return (
    <div>
      <PageHeader
        title="เอกสารเปลี่ยนเครื่อง"
        subtitle="คิวคำขอเปลี่ยน — รออนุมัติจาก OWNER"
        icon={<RefreshCw className="size-5" />}
      />

      <QueryBoundary
        isLoading={isLoading && !requests}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดรายการคำขอเปลี่ยนเครื่องได้"
      >
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
          <CardHeader>
            <h2 className="text-base font-semibold leading-snug">
              รายการรอการอนุมัติ{' '}
              {requests && requests.length > 0 && (
                <span className="ml-1 inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning leading-snug">
                  {requests.length} รายการ
                </span>
              )}
            </h2>
          </CardHeader>
          <CardContent className="p-0">
            {!requests || requests.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground leading-snug">
                <RefreshCw className="size-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">ไม่มีคำขอรอการอนุมัติ</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm leading-snug">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium text-muted-foreground">วันที่ขอ</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">สัญญาเดิม</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">ผู้ยื่น</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">
                        เครื่องเดิม → เครื่องใหม่
                      </th>
                      <th className="text-left p-3 font-medium text-muted-foreground">ประเภท/ราคา</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">หมายเหตุ</th>
                      <th className="text-center p-3 font-medium text-muted-foreground">ดำเนินการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((item) => (
                      <tr key={item.id} className="border-t border-border hover:bg-accent/30">
                        <td className="p-3 text-muted-foreground whitespace-nowrap">
                          {formatDateMedium(item.createdAt)}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <Link
                            to={`/contracts/${item.oldContract.id}`}
                            className="text-primary hover:underline font-medium"
                          >
                            {item.oldContract.contractNumber}
                          </Link>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {item.oldContract.customer.name}
                          </div>
                        </td>
                        <td className="p-3 text-muted-foreground">{item.requestedBy.name}</td>
                        <td className="p-3 min-w-[240px]">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground line-through text-xs">
                              {productLabel(item.oldProduct)}
                            </span>
                            <span className="font-medium text-foreground">
                              {productLabel(item.newProduct)}
                            </span>
                          </div>
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <span className={item.mode === 'MEMO'
                            ? 'inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
                            : 'inline-flex rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary'}>
                            {item.mode === 'MEMO' ? 'MEMO' : `฿${item.buybackPrice ?? '—'}`}
                          </span>
                          {item.approvalTier && item.approvalTier !== 'AUTO' && (
                            <span className={`ml-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              item.approvalTier === 'REVIEW' ? 'bg-warning/15 text-warning' : 'bg-destructive/15 text-destructive'}`}>
                              {item.approvalTier === 'REVIEW' ? 'ผจก.สาขา' : 'ผจก.ใหญ่'}
                            </span>
                          )}
                        </td>
                        <td className="p-3 max-w-[200px]">
                          {item.conditionNote ? (
                            <span className="line-clamp-2 leading-snug text-muted-foreground">
                              {item.conditionNote}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              size="sm"
                              variant="primary"
                              className="h-7 px-3 text-xs"
                              onClick={() => handleApprove(item)}
                            >
                              อนุมัติ
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-3 text-xs text-destructive border-destructive/50 hover:bg-destructive/10"
                              onClick={() => handleReject(item)}
                            >
                              ปฏิเสธ
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </QueryBoundary>

      <div className="mt-6">
        <QueryBoundary
          isLoading={isRecentLoading && !recentRequests}
          isError={isRecentError}
          error={recentError}
          onRetry={refetchRecent}
          errorTitle="ไม่สามารถโหลดรายการที่อนุมัติแล้วได้"
        >
          <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
            <CardHeader>
              <h2 className="text-base font-semibold leading-snug">
                อนุมัติแล้ว (ยกเลิกได้ภายใน 30 วัน)
              </h2>
            </CardHeader>
            <CardContent className="p-0">
              {!recentRequests || recentRequests.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground leading-snug">
                  <RefreshCw className="size-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">ไม่มีรายการที่อนุมัติในช่วง 90 วันล่าสุด</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm leading-snug">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium text-muted-foreground">วันเปลี่ยน</th>
                        <th className="text-left p-3 font-medium text-muted-foreground">
                          สัญญาเดิม → ใหม่
                        </th>
                        <th className="text-left p-3 font-medium text-muted-foreground">เหลือ</th>
                        <th className="text-center p-3 font-medium text-muted-foreground">ดำเนินการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentRequests.map((item) => {
                        const dateStr = exchangeDate(item);
                        const dDays = diffDaysFrom(dateStr);
                        const remainingDays = dDays !== null ? 30 - dDays : null;
                        const newContractInactive =
                          item.mode !== 'MEMO' && item.newContract?.status !== 'ACTIVE';
                        const expired = dDays !== null && dDays > 30;
                        const disabled = dDays === null || newContractInactive || expired;
                        const disabledTitle =
                          dDays === null
                            ? 'ยังไม่มีวันที่เปลี่ยนเครื่อง'
                            : newContractInactive
                              ? `สัญญาใหม่สถานะ ${item.newContract?.status ?? 'ไม่พบ'} — ยกเลิกไม่ได้`
                              : expired
                                ? 'เกิน 30 วันนับจากวันเปลี่ยนเครื่อง — ยกเลิกไม่ได้'
                                : undefined;
                        return (
                          <tr key={item.id} className="border-t border-border hover:bg-accent/30">
                            <td className="p-3 text-muted-foreground whitespace-nowrap">
                              {dateStr ? formatDateMedium(dateStr) : '—'}
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              <Link
                                to={`/contracts/${item.oldContract.id}`}
                                className="text-primary hover:underline font-medium"
                              >
                                {item.oldContract.contractNumber}
                              </Link>
                              {item.newContract ? (
                                <>
                                  <span className="mx-1 text-muted-foreground">→</span>
                                  <Link
                                    to={`/contracts/${item.newContract.id}`}
                                    className="text-primary hover:underline font-medium"
                                  >
                                    {item.newContract.contractNumber}
                                  </Link>
                                </>
                              ) : (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  สัญญาเดิม (MEMO)
                                </span>
                              )}
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {item.oldContract.customer.name}
                              </div>
                            </td>
                            <td className="p-3 text-muted-foreground whitespace-nowrap">
                              {remainingDays === null
                                ? '—'
                                : remainingDays > 0
                                  ? `เหลือ ${remainingDays} วัน`
                                  : 'หมดอายุ'}
                            </td>
                            <td className="p-3">
                              <div className="flex items-center justify-center">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-3 text-xs text-destructive border-destructive/50 hover:bg-destructive/10"
                                  disabled={disabled}
                                  title={disabledTitle}
                                  onClick={() => handleCancelRequest(item)}
                                >
                                  ยกเลิก swap
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </QueryBoundary>
      </div>

      {/* Approve confirm dialog (PRICED) */}
      <ConfirmDialog
        open={target?.action === 'approve' && target?.mode !== 'MEMO'}
        onOpenChange={(open) => !open && setTarget(null)}
        title="ยืนยันการอนุมัติเปลี่ยนเครื่อง"
        description={`อนุมัติการเปลี่ยนเครื่อง สัญญา ${target?.contractNumber ?? ''} — ระบบจะสร้างสัญญาใหม่ (สถานะ DRAFT) ลูกค้าต้องลงนามและกด "เปิดใช้สัญญา" ก่อนจึงจะเริ่มใช้งานและบันทึก JE`}
        confirmLabel="อนุมัติ"
        cancelLabel="ยกเลิก"
        variant="default"
        loading={isMutating}
        onConfirm={handleApproveConfirm}
      />

      {/* Approve dialog (MEMO) — checklist gate: both boxes required before enabling confirm */}
      <Dialog
        open={target?.action === 'approve' && target?.mode === 'MEMO'}
        onOpenChange={(open) => {
          if (!open) {
            setTarget(null);
            setMemoAddendumSigned(false);
            setMemoMdmSwapped(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ยืนยันการอนุมัติเปลี่ยนเครื่อง (MEMO)</DialogTitle>
            <DialogDescription>
              สัญญา <span className="font-semibold">{target?.contractNumber ?? ''}</span> — เปลี่ยนรุ่นเดียวกัน
              ราคาเดิม ไม่มีรายการบัญชี ต้องยืนยัน checklist ก่อนอนุมัติ
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer px-3 py-2.5 rounded-lg bg-muted hover:bg-accent transition-colors">
              <input
                type="checkbox"
                checked={memoAddendumSigned}
                onChange={(e) => setMemoAddendumSigned(e.target.checked)}
                className="rounded border-border text-primary focus:ring-2 focus:ring-primary/20"
              />
              <span className="text-sm font-medium text-foreground leading-snug">
                บันทึกแนบท้ายสัญญา (ADDENDUM) เซ็นแล้ว
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer px-3 py-2.5 rounded-lg bg-muted hover:bg-accent transition-colors">
              <input
                type="checkbox"
                checked={memoMdmSwapped}
                onChange={(e) => setMemoMdmSwapped(e.target.checked)}
                className="rounded border-border text-primary focus:ring-2 focus:ring-primary/20"
              />
              <span className="text-sm font-medium text-foreground leading-snug">
                สลับ MDM เครื่องเก่า → เครื่องใหม่แล้ว
              </span>
            </label>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setTarget(null);
                setMemoAddendumSigned(false);
                setMemoMdmSwapped(false);
              }}
              disabled={isMutating}
            >
              ยกเลิก
            </Button>
            <Button
              variant="primary"
              onClick={handleMemoApproveConfirm}
              disabled={isMutating || !memoAddendumSigned || !memoMdmSwapped}
            >
              {isMutating ? 'กำลังดำเนินการ...' : 'อนุมัติ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel swap dialog — reason textarea + conditional 8-30d penalty warning */}
      <Dialog
        open={!!cancelTarget}
        onOpenChange={(open) => {
          if (!open) {
            setCancelTarget(null);
            setCancelReason('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ยกเลิกการเปลี่ยนเครื่อง</DialogTitle>
            <DialogDescription>
              ยกเลิก swap สัญญา{' '}
              <span className="font-semibold">{cancelTarget?.contractNumber ?? ''}</span>{' '}
              — กรุณาระบุเหตุผล (อย่างน้อย 10 ตัวอักษร)
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 min-h-[80px] resize-none"
              placeholder="ระบุเหตุผลในการยกเลิก..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            {cancelReason.length > 0 && cancelReason.trim().length < 10 && (
              <p className="mt-1 text-xs text-destructive leading-snug">
                กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร ({cancelReason.trim().length}/10)
              </p>
            )}
          </div>
          {cancelTarget && cancelTarget.mode !== 'MEMO' && cancelTarget.diffDays >= 8 && (
            <p className="mt-2 text-xs text-warning leading-snug">
              วันที่ 8-30 มีค่าปรับ 5% ของราคารับซื้อ
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setCancelTarget(null);
                setCancelReason('');
              }}
              disabled={cancelMutation.isPending}
            >
              ปิด
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelConfirm}
              disabled={cancelMutation.isPending || cancelReason.trim().length < 10}
            >
              {cancelMutation.isPending ? 'กำลังดำเนินการ...' : 'ยืนยันยกเลิก swap'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog — needs textarea for reason input */}
      <Dialog
        open={target?.action === 'reject'}
        onOpenChange={(open) => {
          if (!open) {
            setTarget(null);
            setRejectReason('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ปฏิเสธคำขอเปลี่ยนเครื่อง</DialogTitle>
            <DialogDescription>
              ปฏิเสธคำขอสัญญา{' '}
              <span className="font-semibold">{target?.contractNumber ?? ''}</span>{' '}
              — กรุณาระบุเหตุผล (อย่างน้อย 10 ตัวอักษร)
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 min-h-[80px] resize-none"
              placeholder="ระบุเหตุผลในการปฏิเสธ..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            {rejectReason.length > 0 && rejectReason.trim().length < 10 && (
              <p className="mt-1 text-xs text-destructive leading-snug">
                กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร ({rejectReason.trim().length}/10)
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setTarget(null);
                setRejectReason('');
              }}
              disabled={isMutating}
            >
              ยกเลิก
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectConfirm}
              disabled={isMutating || rejectReason.trim().length < 10}
            >
              {isMutating ? 'กำลังดำเนินการ...' : 'ปฏิเสธ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
