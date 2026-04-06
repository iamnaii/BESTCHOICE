import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { DollarSign, CheckCircle, Clock, Banknote } from 'lucide-react';

interface Commission {
  id: string;
  salesperson: { id: string; name: string };
  contract?: { contractNumber: string } | null;
  sale?: { id: string } | null;
  saleAmount: string;
  commissionRate: string;
  commissionAmount: string;
  status: 'PENDING' | 'APPROVED' | 'PAID';
  createdAt: string;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รออนุมัติ', className: 'bg-warning/10 text-warning' },
  APPROVED: { label: 'อนุมัติแล้ว', className: 'bg-primary/10 text-primary' },
  PAID: { label: 'จ่ายแล้ว', className: 'bg-success/10 text-success' },
};

export default function CommissionsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isSales = user?.role === 'SALES';
  const canManage = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';

  const [statusFilter, setStatusFilter] = useState('');
  const [periodMonth, setPeriodMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const { data: commissions = [], isLoading } = useQuery<Commission[]>({
    queryKey: ['commissions', statusFilter, periodMonth, isSales],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (isSales) params.set('salespersonId', 'me');
      if (statusFilter) params.set('status', statusFilter);
      if (periodMonth) {
        const [year, month] = periodMonth.split('-');
        const startDate = `${year}-${month}-01`;
        const endDay = new Date(Number(year), Number(month), 0).getDate();
        const endDate = `${year}-${month}-${String(endDay).padStart(2, '0')}`;
        params.set('startDate', startDate);
        params.set('endDate', endDate);
      }
      const { data } = await api.get(`/commissions?${params}`);
      return data.data || data || [];
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch(`/commissions/${id}/approve`);
      return data;
    },
    onSuccess: () => {
      toast.success('อนุมัติคอมมิชชันสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['commissions'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const payMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch(`/commissions/${id}/pay`);
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกการจ่ายคอมมิชชันสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['commissions'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Summary calculations
  const summary = useMemo(() => {
    const list = Array.isArray(commissions) ? commissions : [];
    return {
      totalCommission: list.reduce((sum, c) => sum + (parseFloat(c.commissionAmount) || 0), 0),
      pendingCount: list.filter((c) => c.status === 'PENDING').length,
      approvedCount: list.filter((c) => c.status === 'APPROVED').length,
      paidCount: list.filter((c) => c.status === 'PAID').length,
    };
  }, [commissions]);

  const columns = useMemo(
    () => [
      ...(!isSales
        ? [
            {
              key: 'salesperson',
              label: 'พนักงานขาย',
              render: (c: Commission) => (
                <span className="text-sm font-medium">{c.salesperson?.name || '-'}</span>
              ),
            },
          ]
        : []),
      {
        key: 'contract',
        label: 'สัญญา/ขาย',
        render: (c: Commission) => (
          <span className="text-sm font-mono">
            {c.contract?.contractNumber || c.sale?.id?.slice(0, 8) || '-'}
          </span>
        ),
      },
      {
        key: 'saleAmount',
        label: 'ยอดขาย',
        render: (c: Commission) => (
          <span className="text-sm">{parseFloat(c.saleAmount).toLocaleString()} ฿</span>
        ),
      },
      {
        key: 'commissionRate',
        label: 'อัตรา',
        render: (c: Commission) => (
          <span className="text-sm">{parseFloat(c.commissionRate).toFixed(1)}%</span>
        ),
      },
      {
        key: 'commissionAmount',
        label: 'คอมมิชชัน',
        render: (c: Commission) => (
          <span className="text-sm font-semibold">
            {parseFloat(c.commissionAmount).toLocaleString()} ฿
          </span>
        ),
      },
      {
        key: 'status',
        label: 'สถานะ',
        render: (c: Commission) => {
          const config = statusConfig[c.status] || {
            label: c.status,
            className: 'bg-muted text-muted-foreground',
          };
          return (
            <span className={`inline-flex px-2.5 py-0.5 rounded-md text-xs font-medium ${config.className}`}>
              {config.label}
            </span>
          );
        },
      },
      ...(canManage
        ? [
            {
              key: 'actions',
              label: '',
              render: (c: Commission) => (
                <div className="flex gap-2">
                  {c.status === 'PENDING' && (
                    <button
                      onClick={() => approveMutation.mutate(c.id)}
                      disabled={approveMutation.isPending}
                      className="px-3 py-1.5 text-xs font-medium bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors disabled:opacity-50"
                    >
                      อนุมัติ
                    </button>
                  )}
                  {c.status === 'APPROVED' && (
                    <button
                      onClick={() => payMutation.mutate(c.id)}
                      disabled={payMutation.isPending}
                      className="px-3 py-1.5 text-xs font-medium bg-success/10 text-success rounded-lg hover:bg-success/20 transition-colors disabled:opacity-50"
                    >
                      จ่าย
                    </button>
                  )}
                </div>
              ),
            },
          ]
        : []),
    ],
    [isSales, canManage, approveMutation, payMutation],
  );

  return (
    <div>
      <PageHeader
        title="คอมมิชชัน"
        subtitle="จัดการคอมมิชชันพนักงานขาย"
        icon={<DollarSign className="size-5" />}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 lg:gap-5 mb-6">
        <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-primary">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="size-4 text-primary" />
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
                รวมเดือนนี้
              </div>
            </div>
            <div className="text-2xl font-bold">{summary.totalCommission.toLocaleString()} ฿</div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-warning">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="size-4 text-warning" />
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
                รออนุมัติ
              </div>
            </div>
            <div className="text-2xl font-bold">{summary.pendingCount}</div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-primary">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="size-4 text-primary" />
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
                อนุมัติแล้ว
              </div>
            </div>
            <div className="text-2xl font-bold">{summary.approvedCount}</div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-success">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Banknote className="size-4 text-success" />
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
                จ่ายแล้ว
              </div>
            </div>
            <div className="text-2xl font-bold">{summary.paidCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          type="month"
          value={periodMonth}
          onChange={(e) => setPeriodMonth(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background focus:border-transparent"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm"
        >
          <option value="">ทุกสถานะ</option>
          <option value="PENDING">รออนุมัติ</option>
          <option value="APPROVED">อนุมัติแล้ว</option>
          <option value="PAID">จ่ายแล้ว</option>
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={Array.isArray(commissions) ? commissions : []}
          emptyMessage="ไม่พบข้อมูลคอมมิชชัน"
        />
      )}
    </div>
  );
}
