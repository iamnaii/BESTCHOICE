import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardCheck, CalendarClock, CheckCircle2, XCircle, LinkIcon } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ApplicationStatus =
  | 'SUBMITTED'
  | 'SCHEDULED'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'CONTRACT_SIGNED'
  | 'REJECTED'
  | 'NO_SHOW'
  | 'EXPIRED'
  | 'CANCELLED';

interface InstallmentApplication {
  id: string;
  applicationNumber: string;
  fullName: string;
  phone: string;
  nationalId?: string;
  productId: string;
  product?: { id: string; name: string; model?: string | null } | null;
  proposedDownPayment: string | number;
  proposedTotalMonths: number;
  proposedMonthlyPayment: string | number;
  status: ApplicationStatus;
  scheduledAt?: string | null;
  rejectReason?: string | null;
  contractId?: string | null;
  createdAt: string;
}

interface ApplicationsResponse {
  data: InstallmentApplication[];
  total?: number;
}

const STATUS_TABS: Array<{ key: ApplicationStatus | 'ALL'; label: string }> = [
  { key: 'ALL', label: 'ทั้งหมด' },
  { key: 'SUBMITTED', label: 'รอจัดคิว' },
  { key: 'SCHEDULED', label: 'นัดแล้ว' },
  { key: 'APPROVED', label: 'อนุมัติแล้ว' },
  { key: 'CONTRACT_SIGNED', label: 'ทำสัญญาแล้ว' },
  { key: 'REJECTED', label: 'ปฏิเสธ' },
  { key: 'NO_SHOW', label: 'ไม่มาตามนัด' },
  { key: 'CANCELLED', label: 'ยกเลิก' },
];

const STATUS_BADGE: Record<ApplicationStatus, { label: string; variant: 'primary' | 'success' | 'warning' | 'destructive' | 'secondary' | 'info' }> = {
  SUBMITTED: { label: 'รอจัดคิว', variant: 'warning' },
  SCHEDULED: { label: 'นัดแล้ว', variant: 'info' },
  IN_REVIEW: { label: 'กำลังพิจารณา', variant: 'info' },
  APPROVED: { label: 'อนุมัติแล้ว', variant: 'success' },
  CONTRACT_SIGNED: { label: 'ทำสัญญาแล้ว', variant: 'success' },
  REJECTED: { label: 'ปฏิเสธ', variant: 'destructive' },
  NO_SHOW: { label: 'ไม่มาตามนัด', variant: 'destructive' },
  EXPIRED: { label: 'หมดอายุ', variant: 'secondary' },
  CANCELLED: { label: 'ยกเลิก', variant: 'secondary' },
};

function formatMoney(v: string | number | undefined | null): string {
  if (v === null || v === undefined) return '-';
  const n = typeof v === 'string' ? Number(v) : v;
  if (Number.isNaN(n)) return '-';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function InstallmentApplicationsPage() {
  useDocumentTitle('คำขอผ่อนชำระออนไลน์');
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | 'ALL'>('ALL');
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, string>>({});
  const [rejectInputs, setRejectInputs] = useState<Record<string, string>>({});
  const [contractInputs, setContractInputs] = useState<Record<string, string>>({});

  const { data, isLoading, isError, error, refetch } = useQuery<ApplicationsResponse>({
    queryKey: ['admin-installment-applications', statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      const qs = params.toString();
      const res = await api.get(`/admin/installment-applications${qs ? `?${qs}` : ''}`);
      const body = res.data;
      if (Array.isArray(body)) return { data: body, total: body.length };
      return body;
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: async ({ id, scheduledAt }: { id: string; scheduledAt: string }) =>
      api.patch(`/admin/installment-applications/${id}/schedule`, { scheduledAt }),
    onSuccess: (_d, vars) => {
      toast.success('นัดเยี่ยมชมเรียบร้อย');
      setScheduleInputs((prev) => {
        const next = { ...prev };
        delete next[vars.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['admin-installment-applications'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => api.patch(`/admin/installment-applications/${id}/approve`),
    onSuccess: () => {
      toast.success('อนุมัติคำขอเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['admin-installment-applications'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, rejectReason }: { id: string; rejectReason: string }) =>
      api.patch(`/admin/installment-applications/${id}/reject`, { rejectReason }),
    onSuccess: (_d, vars) => {
      toast.success('ปฏิเสธคำขอเรียบร้อย');
      setRejectInputs((prev) => {
        const next = { ...prev };
        delete next[vars.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['admin-installment-applications'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const linkContractMutation = useMutation({
    mutationFn: async ({ id, contractId }: { id: string; contractId: string }) =>
      api.patch(`/admin/installment-applications/${id}/link-contract`, { contractId }),
    onSuccess: (_d, vars) => {
      toast.success('ผูกสัญญาเรียบร้อย');
      setContractInputs((prev) => {
        const next = { ...prev };
        delete next[vars.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['admin-installment-applications'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const apps = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="คำขอผ่อนชำระออนไลน์"
        subtitle="จัดคิวนัดเยี่ยมชม อนุมัติคำขอ และผูกสัญญาเมื่อลูกค้ามาเซ็นที่สาขา"
        icon={<ClipboardCheck className="size-5" />}
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 rounded-md text-sm leading-snug transition-colors ${
              statusFilter === tab.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={refetch}>
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left font-medium">เลขที่คำขอ</th>
                <th className="px-4 py-3 text-left font-medium">ชื่อ-เบอร์</th>
                <th className="px-4 py-3 text-left font-medium">สินค้า</th>
                <th className="px-4 py-3 text-right font-medium">ดาวน์</th>
                <th className="px-4 py-3 text-center font-medium">งวด</th>
                <th className="px-4 py-3 text-right font-medium">ค่างวด/เดือน</th>
                <th className="px-4 py-3 text-left font-medium">สถานะ</th>
                <th className="px-4 py-3 text-left font-medium">การดำเนินการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {apps.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    ไม่มีคำขอในสถานะนี้
                  </td>
                </tr>
              ) : (
                apps.map((app) => {
                  const badge = STATUS_BADGE[app.status];
                  const schedule = scheduleInputs[app.id] ?? '';
                  const reject = rejectInputs[app.id] ?? '';
                  const contractId = contractInputs[app.id] ?? '';
                  return (
                    <tr key={app.id} className="hover:bg-accent/30 align-top">
                      <td className="px-4 py-3 font-medium text-foreground">{app.applicationNumber}</td>
                      <td className="px-4 py-3 text-foreground">
                        <div className="leading-snug">{app.fullName}</div>
                        <div className="text-xs text-muted-foreground leading-snug">{app.phone}</div>
                      </td>
                      <td className="px-4 py-3 text-foreground leading-snug">
                        {app.product?.name ?? '-'}
                        {app.product?.model && (
                          <div className="text-xs text-muted-foreground">{app.product.model}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-foreground">
                        {formatMoney(app.proposedDownPayment)}
                      </td>
                      <td className="px-4 py-3 text-center text-foreground">
                        {app.proposedTotalMonths}
                      </td>
                      <td className="px-4 py-3 text-right text-foreground">
                        {formatMoney(app.proposedMonthlyPayment)}
                      </td>
                      <td className="px-4 py-3">
                        {badge ? (
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        ) : (
                          <Badge variant="secondary">{app.status}</Badge>
                        )}
                        {app.status === 'SCHEDULED' && app.scheduledAt && (
                          <div className="text-xs text-muted-foreground leading-snug mt-1">
                            {formatDateTime(app.scheduledAt)}
                          </div>
                        )}
                        {app.status === 'REJECTED' && app.rejectReason && (
                          <div className="text-xs text-muted-foreground leading-snug mt-1 max-w-[180px]">
                            {app.rejectReason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-2 min-w-[240px]">
                          {app.status === 'SUBMITTED' && (
                            <>
                              <div className="flex flex-col gap-1.5">
                                <Input
                                  variant="sm"
                                  type="datetime-local"
                                  value={schedule}
                                  onChange={(e) =>
                                    setScheduleInputs((prev) => ({
                                      ...prev,
                                      [app.id]: e.target.value,
                                    }))
                                  }
                                />
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    if (!schedule) {
                                      toast.error('กรุณาเลือกวันและเวลานัด');
                                      return;
                                    }
                                    scheduleMutation.mutate({
                                      id: app.id,
                                      scheduledAt: new Date(schedule).toISOString(),
                                    });
                                  }}
                                  disabled={scheduleMutation.isPending}
                                >
                                  <CalendarClock className="size-4 mr-1.5" />
                                  นัดเยี่ยมชม
                                </Button>
                              </div>
                              <div className="flex gap-1.5">
                                <Input
                                  variant="sm"
                                  placeholder="เหตุผลปฏิเสธ"
                                  value={reject}
                                  onChange={(e) =>
                                    setRejectInputs((prev) => ({
                                      ...prev,
                                      [app.id]: e.target.value,
                                    }))
                                  }
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    if (!reject.trim()) {
                                      toast.error('กรุณาระบุเหตุผล');
                                      return;
                                    }
                                    rejectMutation.mutate({
                                      id: app.id,
                                      rejectReason: reject.trim(),
                                    });
                                  }}
                                  disabled={rejectMutation.isPending}
                                >
                                  <XCircle className="size-4" />
                                </Button>
                              </div>
                            </>
                          )}
                          {app.status === 'SCHEDULED' && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => approveMutation.mutate(app.id)}
                                disabled={approveMutation.isPending}
                              >
                                <CheckCircle2 className="size-4 mr-1.5" />
                                อนุมัติ
                              </Button>
                              <div className="flex gap-1.5">
                                <Input
                                  variant="sm"
                                  placeholder="เหตุผลปฏิเสธ"
                                  value={reject}
                                  onChange={(e) =>
                                    setRejectInputs((prev) => ({
                                      ...prev,
                                      [app.id]: e.target.value,
                                    }))
                                  }
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    if (!reject.trim()) {
                                      toast.error('กรุณาระบุเหตุผล');
                                      return;
                                    }
                                    rejectMutation.mutate({
                                      id: app.id,
                                      rejectReason: reject.trim(),
                                    });
                                  }}
                                  disabled={rejectMutation.isPending}
                                >
                                  <XCircle className="size-4" />
                                </Button>
                              </div>
                            </>
                          )}
                          {app.status === 'APPROVED' && (
                            <div className="flex flex-col gap-1.5">
                              <Input
                                variant="sm"
                                placeholder="Contract ID"
                                value={contractId}
                                onChange={(e) =>
                                  setContractInputs((prev) => ({
                                    ...prev,
                                    [app.id]: e.target.value,
                                  }))
                                }
                              />
                              <Button
                                size="sm"
                                onClick={() => {
                                  if (!contractId.trim()) {
                                    toast.error('กรุณาระบุ Contract ID');
                                    return;
                                  }
                                  linkContractMutation.mutate({
                                    id: app.id,
                                    contractId: contractId.trim(),
                                  });
                                }}
                                disabled={linkContractMutation.isPending}
                              >
                                <LinkIcon className="size-4 mr-1.5" />
                                ผูกสัญญา
                              </Button>
                            </div>
                          )}
                          {app.status === 'CONTRACT_SIGNED' && app.contractId && (
                            <div className="text-xs text-muted-foreground leading-snug">
                              สัญญา: {app.contractId}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </QueryBoundary>
    </div>
  );
}
