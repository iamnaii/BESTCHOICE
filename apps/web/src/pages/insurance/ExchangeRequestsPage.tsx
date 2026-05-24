import { useState } from 'react';
import { Link } from 'react-router';
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
  oldContract: {
    id: string;
    contractNumber: string;
    customer: { id: string; name: string; phone: string };
  };
  oldProduct: { id: string; brand: string; model: string; storage: string | null; imeiSerial: string | null };
  newProduct: { id: string; brand: string; model: string; storage: string | null; imeiSerial: string | null };
  requestedBy: { id: string; name: string };
}

type ActionTarget = {
  id: string;
  contractNumber: string;
  action: 'approve' | 'reject';
};

function productLabel(p: PendingExchangeRequest['oldProduct']): string {
  const parts = [p.brand, p.model, p.storage].filter(Boolean).join(' ');
  return parts || '—';
}

export default function ExchangeRequestsPage() {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<ActionTarget | null>(null);
  const [rejectReason, setRejectReason] = useState('');

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

  const approveMutation = useMutation({
    mutationFn: (requestId: string) =>
      api.post(`/insurance/exchange-requests/${requestId}/approve`),
    onSuccess: () => {
      toast.success('อนุมัติการเปลี่ยนเครื่องสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['exchange-requests-pending'] });
      setTarget(null);
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

  const handleApprove = (item: PendingExchangeRequest) => {
    setTarget({ id: item.id, contractNumber: item.oldContract.contractNumber, action: 'approve' });
  };

  const handleReject = (item: PendingExchangeRequest) => {
    setRejectReason('');
    setTarget({ id: item.id, contractNumber: item.oldContract.contractNumber, action: 'reject' });
  };

  const handleApproveConfirm = () => {
    if (!target) return;
    approveMutation.mutate(target.id);
  };

  const handleRejectConfirm = () => {
    if (!target || rejectReason.trim().length < 10) return;
    rejectMutation.mutate({ id: target.id, reason: rejectReason });
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

      {/* Approve confirm dialog */}
      <ConfirmDialog
        open={target?.action === 'approve'}
        onOpenChange={(open) => !open && setTarget(null)}
        title="ยืนยันการอนุมัติเปลี่ยนเครื่อง"
        description={`อนุมัติการเปลี่ยนเครื่อง สัญญา ${target?.contractNumber ?? ''} — ระบบจะสร้างสัญญาใหม่ + post JE 3 ชุดอัตโนมัติ`}
        confirmLabel="อนุมัติ"
        cancelLabel="ยกเลิก"
        variant="default"
        loading={isMutating}
        onConfirm={handleApproveConfirm}
      />

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
