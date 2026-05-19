import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
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
import { formatDateMedium, formatNumberDecimal } from '@/utils/formatters';

interface PendingCancellation {
  id: string;
  createdAt: string;
  reason: string;
  refundAmount: number | string;
  status: 'PENDING';
  contract: {
    id: string;
    contractNumber: string;
    status: string;
    customer: {
      id: string;
      name: string;
      phone: string;
    };
  };
  requestedBy: {
    id: string;
    name: string;
  };
}

type ActionTarget = {
  id: string;
  contractNumber: string;
  action: 'approve' | 'reject';
};

export default function ContractCancellationPage() {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<ActionTarget | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: cancellations, isLoading, isError, error, refetch } = useQuery<PendingCancellation[]>({
    queryKey: ['contract-cancellations-pending'],
    queryFn: async () => (await api.get('/contracts/cancellations/pending')).data,
  });

  const approveMutation = useMutation({
    mutationFn: (cancellationId: string) =>
      api.post(`/contracts/cancellations/${cancellationId}/approve`),
    onSuccess: () => {
      toast.success('อนุมัติการยกเลิกสัญญาสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['contract-cancellations-pending'] });
      setTarget(null);
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'เกิดข้อผิดพลาด กรุณาลองใหม่';
      toast.error(msg);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/contracts/cancellations/${id}/reject`, { reason }),
    onSuccess: () => {
      toast.success('ปฏิเสธคำขอยกเลิกสัญญาแล้ว');
      queryClient.invalidateQueries({ queryKey: ['contract-cancellations-pending'] });
      setTarget(null);
      setRejectReason('');
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'เกิดข้อผิดพลาด กรุณาลองใหม่';
      toast.error(msg);
    },
  });

  const handleApprove = (item: PendingCancellation) => {
    setTarget({ id: item.id, contractNumber: item.contract.contractNumber, action: 'approve' });
  };

  const handleReject = (item: PendingCancellation) => {
    setRejectReason('');
    setTarget({ id: item.id, contractNumber: item.contract.contractNumber, action: 'reject' });
  };

  const handleApproveConfirm = () => {
    if (!target) return;
    approveMutation.mutate(target.id);
  };

  const handleRejectConfirm = () => {
    if (!target) return;
    rejectMutation.mutate({ id: target.id, reason: rejectReason });
  };

  const isMutating = approveMutation.isPending || rejectMutation.isPending;

  return (
    <div>
      <PageHeader
        title="เอกสารยกเลิกสัญญา"
        subtitle="คิวคำขอยกเลิก — รออนุมัติจากผู้จัดการ"
        icon={<Lock className="size-5" />}
      />

      <QueryBoundary
        isLoading={isLoading && !cancellations}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดรายการคำขอยกเลิกสัญญาได้"
      >
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
          <CardHeader>
            <h2 className="text-base font-semibold leading-snug">
              รายการรอการอนุมัติ{' '}
              {cancellations && cancellations.length > 0 && (
                <span className="ml-1 inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning leading-snug">
                  {cancellations.length} รายการ
                </span>
              )}
            </h2>
          </CardHeader>
          <CardContent className="p-0">
            {!cancellations || cancellations.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground leading-snug">
                <Lock className="size-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">ไม่มีคำขอรอการอนุมัติ</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm leading-snug">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium text-muted-foreground">วันที่ขอ</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">เลขสัญญา</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">ลูกค้า</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">ผู้ยื่นคำขอ</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">เหตุผล</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">
                        ยอดคืน (฿)
                      </th>
                      <th className="text-center p-3 font-medium text-muted-foreground">
                        ดำเนินการ
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cancellations.map((item) => (
                      <tr key={item.id} className="border-t border-border hover:bg-accent/30">
                        <td className="p-3 text-muted-foreground whitespace-nowrap">
                          {formatDateMedium(item.createdAt)}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <Link
                            to={`/contracts/${item.contract.id}`}
                            className="text-primary hover:underline font-medium"
                          >
                            {item.contract.contractNumber}
                          </Link>
                        </td>
                        <td className="p-3">
                          <div className="font-medium">{item.contract.customer.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {item.contract.customer.phone || '—'}
                          </div>
                        </td>
                        <td className="p-3 text-muted-foreground">{item.requestedBy.name}</td>
                        <td className="p-3 max-w-[240px]">
                          <span className="line-clamp-2 leading-snug">{item.reason}</span>
                        </td>
                        <td className="p-3 text-right tabular-nums font-semibold">
                          {formatNumberDecimal(Number(item.refundAmount), 2)} ฿
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
        title="ยืนยันการอนุมัติยกเลิกสัญญา"
        description={`อนุมัติการยกเลิกสัญญา ${target?.contractNumber ?? ''} ระบบจะบันทึกรายการย้อนกลับ JE อัตโนมัติ`}
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
            <DialogTitle>ปฏิเสธคำขอยกเลิกสัญญา</DialogTitle>
            <DialogDescription>
              ปฏิเสธคำขอสัญญา{' '}
              <span className="font-semibold">{target?.contractNumber ?? ''}</span>{' '}
              — กรุณาระบุเหตุผล
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 min-h-[80px] resize-none"
              placeholder="ระบุเหตุผลในการปฏิเสธ..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
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
              disabled={isMutating || !rejectReason.trim()}
            >
              {isMutating ? 'กำลังดำเนินการ...' : 'ปฏิเสธ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
