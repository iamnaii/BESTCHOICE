import { useState, useMemo } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { DollarSign, CheckCircle, Clock, Banknote, ListOrdered, Sparkles } from 'lucide-react';

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

interface CommissionPayout {
  id: string;
  period: string;
  salesperson: { id: string; name: string };
  totalSales: string;
  totalCommission: string;
  commissionCount: number;
  status: 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED';
  approvedBy?: { name: string } | null;
  paidBy?: { name: string } | null;
  approvedAt?: string | null;
  paidAt?: string | null;
  notes?: string | null;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รออนุมัติ', className: 'bg-warning/10 text-warning' },
  APPROVED: { label: 'อนุมัติแล้ว', className: 'bg-primary/10 text-primary' },
  PAID: { label: 'จ่ายแล้ว', className: 'bg-success/10 text-success' },
};

const payoutStatusConfig: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'ร่าง', className: 'bg-muted text-muted-foreground' },
  APPROVED: { label: 'อนุมัติแล้ว', className: 'bg-primary/10 text-primary' },
  PAID: { label: 'จ่ายแล้ว', className: 'bg-success/10 text-success' },
  CANCELLED: { label: 'ยกเลิก', className: 'bg-destructive/10 text-destructive' },
};

type Tab = 'commissions' | 'payouts';

export default function CommissionsPage() {
  useDocumentTitle('คอมมิชชัน');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isSales = user?.role === 'SALES';
  const canManage = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';
  const isOwner = user?.role === 'OWNER';

  const [activeTab, setActiveTab] = useState<Tab>('commissions');
  const [statusFilter, setStatusFilter] = useState('');
  const [periodMonth, setPeriodMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [payoutPeriod, setPayoutPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [payoutStatusFilter, setPayoutStatusFilter] = useState('');

  const {
    data: commissions = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<Commission[]>({
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
    enabled: activeTab === 'commissions',
  });

  const {
    data: payoutsResp,
    isLoading: payoutsLoading,
    isError: payoutsError,
    error: payoutsErr,
    refetch: refetchPayouts,
  } = useQuery<{ data: CommissionPayout[]; total: number }>({
    queryKey: ['commission-payouts', payoutPeriod, payoutStatusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (payoutPeriod) params.set('period', payoutPeriod);
      if (payoutStatusFilter) params.set('status', payoutStatusFilter);
      const { data } = await api.get(`/commissions/payouts?${params}`);
      return data;
    },
    enabled: activeTab === 'payouts',
  });

  const payouts = payoutsResp?.data || [];

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

  const generatePayoutMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/commissions/payouts/generate', { period: payoutPeriod });
      return data;
    },
    onSuccess: (data) => {
      toast.success(data.message || 'สร้างใบจ่ายสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['commission-payouts'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const approvePayoutMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch(`/commissions/payouts/${id}/approve`, {});
      return data;
    },
    onSuccess: () => {
      toast.success('อนุมัติใบจ่ายสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['commission-payouts'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const markPayoutPaidMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch(`/commissions/payouts/${id}/paid`);
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกการจ่ายสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['commission-payouts'] });
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

  // Payout summary
  const payoutSummary = useMemo(() => {
    const list = Array.isArray(payouts) ? payouts : [];
    return {
      totalPayout: list.reduce((sum, p) => sum + (parseFloat(p.totalCommission) || 0), 0),
      draftCount: list.filter((p) => p.status === 'DRAFT').length,
      approvedCount: list.filter((p) => p.status === 'APPROVED').length,
      paidCount: list.filter((p) => p.status === 'PAID').length,
    };
  }, [payouts]);

  const commissionColumns = useMemo(
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

  const payoutColumns = useMemo(
    () => [
      {
        key: 'salesperson',
        label: 'พนักงานขาย',
        render: (p: CommissionPayout) => (
          <span className="text-sm font-medium">{p.salesperson?.name || '-'}</span>
        ),
      },
      {
        key: 'period',
        label: 'เดือน',
        render: (p: CommissionPayout) => <span className="text-sm font-mono">{p.period}</span>,
      },
      {
        key: 'commissionCount',
        label: 'จำนวนรายการ',
        render: (p: CommissionPayout) => (
          <span className="text-sm">{p.commissionCount} รายการ</span>
        ),
      },
      {
        key: 'totalSales',
        label: 'ยอดขายรวม',
        render: (p: CommissionPayout) => (
          <span className="text-sm">{parseFloat(p.totalSales).toLocaleString()} ฿</span>
        ),
      },
      {
        key: 'totalCommission',
        label: 'คอมมิชชันรวม',
        render: (p: CommissionPayout) => (
          <span className="text-sm font-semibold text-primary">
            {parseFloat(p.totalCommission).toLocaleString()} ฿
          </span>
        ),
      },
      {
        key: 'status',
        label: 'สถานะ',
        render: (p: CommissionPayout) => {
          const cfg = payoutStatusConfig[p.status] || {
            label: p.status,
            className: 'bg-muted text-muted-foreground',
          };
          return (
            <span className={`inline-flex px-2.5 py-0.5 rounded-md text-xs font-medium ${cfg.className}`}>
              {cfg.label}
            </span>
          );
        },
      },
      ...(isOwner
        ? [
            {
              key: 'actions',
              label: '',
              render: (p: CommissionPayout) => (
                <div className="flex gap-2">
                  {p.status === 'DRAFT' && (
                    <button
                      onClick={() => approvePayoutMutation.mutate(p.id)}
                      disabled={approvePayoutMutation.isPending}
                      className="px-3 py-1.5 text-xs font-medium bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors disabled:opacity-50"
                    >
                      อนุมัติ
                    </button>
                  )}
                  {p.status === 'APPROVED' && (
                    <button
                      onClick={() => markPayoutPaidMutation.mutate(p.id)}
                      disabled={markPayoutPaidMutation.isPending}
                      className="px-3 py-1.5 text-xs font-medium bg-success/10 text-success rounded-lg hover:bg-success/20 transition-colors disabled:opacity-50"
                    >
                      จ่ายแล้ว
                    </button>
                  )}
                </div>
              ),
            },
          ]
        : []),
    ],
    [isOwner, approvePayoutMutation, markPayoutPaidMutation],
  );

  return (
    <div>
      <PageHeader
        title="คอมมิชชัน"
        subtitle="จัดการคอมมิชชันและใบจ่ายพนักงานขาย"
        icon={<DollarSign className="size-5" />}
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        <button
          onClick={() => setActiveTab('commissions')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'commissions'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <ListOrdered className="size-4" />
          รายการคอมมิชชัน
        </button>
        {!isSales && (
          <button
            onClick={() => setActiveTab('payouts')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'payouts'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Sparkles className="size-4" />
            ใบจ่ายรายเดือน
          </button>
        )}
      </div>

      {/* ===== COMMISSIONS TAB ===== */}
      {activeTab === 'commissions' && (
        <>
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
          <QueryBoundary
            isLoading={isLoading}
            isError={isError}
            error={error}
            onRetry={refetch}
            errorTitle="ไม่สามารถโหลดข้อมูลคอมมิชชันได้"
          >
            <DataTable
              columns={commissionColumns}
              data={Array.isArray(commissions) ? commissions : []}
              emptyMessage="ไม่พบข้อมูลคอมมิชชัน"
            />
          </QueryBoundary>
        </>
      )}

      {/* ===== PAYOUTS TAB ===== */}
      {activeTab === 'payouts' && (
        <>
          {/* Payout Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 lg:gap-5 mb-6">
            <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-primary">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="size-4 text-primary" />
                  <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
                    ยอดจ่ายรวม
                  </div>
                </div>
                <div className="text-2xl font-bold">{payoutSummary.totalPayout.toLocaleString()} ฿</div>
              </CardContent>
            </Card>
            <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-muted">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="size-4 text-muted-foreground" />
                  <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
                    ร่าง
                  </div>
                </div>
                <div className="text-2xl font-bold">{payoutSummary.draftCount}</div>
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
                <div className="text-2xl font-bold">{payoutSummary.approvedCount}</div>
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
                <div className="text-2xl font-bold">{payoutSummary.paidCount}</div>
              </CardContent>
            </Card>
          </div>

          {/* Payout Filters & Actions */}
          <div className="flex gap-3 mb-4 flex-wrap items-center">
            <input
              type="month"
              value={payoutPeriod}
              onChange={(e) => setPayoutPeriod(e.target.value)}
              className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background focus:border-transparent"
            />
            <select
              value={payoutStatusFilter}
              onChange={(e) => setPayoutStatusFilter(e.target.value)}
              className="px-3 py-2 border border-input rounded-lg text-sm"
            >
              <option value="">ทุกสถานะ</option>
              <option value="DRAFT">ร่าง</option>
              <option value="APPROVED">อนุมัติแล้ว</option>
              <option value="PAID">จ่ายแล้ว</option>
              <option value="CANCELLED">ยกเลิก</option>
            </select>
            {isOwner && (
              <button
                onClick={() => generatePayoutMutation.mutate()}
                disabled={generatePayoutMutation.isPending || !payoutPeriod}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <Sparkles className="size-4" />
                {generatePayoutMutation.isPending ? 'กำลังสร้าง...' : `สร้างใบจ่าย ${payoutPeriod}`}
              </button>
            )}
          </div>

          {/* Payouts Table */}
          <QueryBoundary
            isLoading={payoutsLoading}
            isError={payoutsError}
            error={payoutsErr}
            onRetry={refetchPayouts}
            errorTitle="ไม่สามารถโหลดข้อมูลใบจ่ายได้"
          >
            <DataTable
              columns={payoutColumns}
              data={payouts}
              emptyMessage="ไม่พบข้อมูลใบจ่าย — กดปุ่ม 'สร้างใบจ่าย' เพื่อรวบรวมคอมมิชชันเดือนนี้"
            />
          </QueryBoundary>
        </>
      )}
    </div>
  );
}
