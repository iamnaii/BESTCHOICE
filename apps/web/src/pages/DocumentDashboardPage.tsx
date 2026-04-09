import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { useAuth } from '@/contexts/AuthContext';
import { formatDateTime } from '@/utils/formatters';

interface DocumentStats {
  totalContracts: number;
  fullyDocumented: number;
  pendingDocuments: number;
  pendingSignatures: number;
  pendingApproval: number;
  overdueContracts: number;
  byBranch: Array<{
    branchId: string;
    branchName: string;
    total: number;
    documented: number;
    pendingDocs: number;
    pendingSigs: number;
  }>;
  recentActivity: Array<{
    id: string;
    contractNumber: string;
    customerName: string;
    action: string;
    createdAt: string;
    branchName: string;
  }>;
  slaAlerts: Array<{
    id: string;
    contractNumber: string;
    customerName: string;
    workflowStatus: string;
    hoursWaiting: number;
    branchName: string;
  }>;
}

function StatCard({ label, value, color = 'blue', icon }: { label: string; value: number; color?: string; icon: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200 border-l-primary',
    green: 'bg-success/5 dark:bg-success/10 text-success border-success/20 border-l-success',
    yellow: 'bg-warning/5 dark:bg-warning/10 text-yellow-700 border-yellow-200 border-l-warning',
    red: 'bg-destructive/5 dark:bg-destructive/10 text-destructive border-destructive/20 border-l-destructive',
    purple: 'bg-purple-50 text-purple-700 border-purple-200 border-l-purple-500',
    orange: 'bg-warning/5 dark:bg-warning/10 text-orange-700 border-orange-200 border-l-warning',
  };
  return (
    <div className={`rounded-xl border border-l-[3px] shadow-sm p-4 hover:shadow-card-hover transition-all ${colors[color] || colors.blue}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-lg">{icon}</span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
    </div>
  );
}

function DocumentDashboardPage() {
  const { user } = useAuth();
  const [selectedBranch, setSelectedBranch] = useState<string>('');

  const { data: stats, isLoading, isError, error, refetch } = useQuery<DocumentStats>({
    queryKey: ['document-dashboard', selectedBranch],
    queryFn: async () => {
      const params = selectedBranch ? { branchId: selectedBranch } : {};
      const { data } = await api.get('/contracts/document-dashboard', { params });
      return data;
    },
    refetchInterval: 60000, // refresh every minute
  });

  const { data: branches } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['branches-list'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
  });

  const s = stats || {
    totalContracts: 0, fullyDocumented: 0, pendingDocuments: 0,
    pendingSignatures: 0, pendingApproval: 0, overdueContracts: 0,
    byBranch: [], recentActivity: [], slaAlerts: [],
  };

  return (
    <QueryBoundary
      isLoading={isLoading && !stats}
      isError={isError}
      error={error}
      onRetry={refetch}
      errorTitle="ไม่สามารถโหลดสถานะเอกสารได้"
    >
    <div className="animate-fade-in">
      <PageHeader title="สถานะเอกสารสัญญา" subtitle="ภาพรวมสถานะเอกสาร ลายเซ็น และการอนุมัติ" />

      {/* Branch filter */}
      {(user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER') && branches && branches.length > 1 && (
        <div className="mb-5">
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="border border-input rounded-lg px-3 py-2 text-sm bg-background focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
          >
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-5 lg:gap-7.5 mb-6">
        <StatCard icon="📋" label="สัญญาทั้งหมด" value={s.totalContracts} color="blue" />
        <StatCard icon="✅" label="เอกสารครบ" value={s.fullyDocumented} color="green" />
        <StatCard icon="📎" label="รอเอกสาร" value={s.pendingDocuments} color="yellow" />
        <StatCard icon="✍️" label="รอลายเซ็น" value={s.pendingSignatures} color="purple" />
        <StatCard icon="⏳" label="รออนุมัติ" value={s.pendingApproval} color="orange" />
        <StatCard icon="🔴" label="ค้างชำระ" value={s.overdueContracts} color="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-7.5">
        {/* SLA Alerts */}
        <div className="bg-card rounded-xl border border-border/50 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-destructive mb-4">
            แจ้งเตือน SLA — สัญญารออนุมัตินาน
          </h3>
          {s.slaAlerts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">ไม่มีรายการ</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {s.slaAlerts.map((alert) => (
                <div key={alert.id} className="flex items-center justify-between p-3 bg-destructive/5 dark:bg-destructive/10 rounded-lg text-sm">
                  <div>
                    <span className="font-medium">{alert.contractNumber}</span>
                    <span className="text-muted-foreground ml-2">{alert.customerName}</span>
                    {alert.branchName && <span className="text-xs text-muted-foreground ml-2">({alert.branchName})</span>}
                  </div>
                  <div className="text-right">
                    <span className={`font-medium text-sm ${alert.hoursWaiting >= 48 ? 'text-destructive' : 'text-yellow-600'}`}>
                      {alert.hoursWaiting >= 24 ? `${Math.floor(alert.hoursWaiting / 24)} วัน` : `${alert.hoursWaiting} ชม.`}
                    </span>
                    <div className="text-xs text-muted-foreground">{alert.workflowStatus}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* By Branch */}
        <div className="bg-card rounded-xl border border-border/50 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">สถานะตามสาขา</h3>
          {s.byBranch.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">ไม่มีข้อมูล</p>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {s.byBranch.map((branch) => {
                const pct = branch.total > 0 ? Math.round((branch.documented / branch.total) * 100) : 0;
                return (
                  <div key={branch.branchId} className="p-3 border border-border/50 rounded-lg text-sm">
                    <div className="flex justify-between mb-2">
                      <span className="font-medium">{branch.branchName}</span>
                      <span className="text-muted-foreground text-xs">{pct}% สมบูรณ์</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5 mb-2">
                      <div
                        className="bg-success h-1.5 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span>ทั้งหมด: {branch.total}</span>
                      <span>รอเอกสาร: {branch.pendingDocs}</span>
                      <span>รอเซ็น: {branch.pendingSigs}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-card rounded-xl border border-border/50 shadow-sm p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-foreground mb-4">กิจกรรมล่าสุด</h3>
          {s.recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">ไม่มีกิจกรรม</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto divide-y divide-border/50">
              {s.recentActivity.map((act) => (
                <div key={act.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{act.contractNumber}</span>
                    <span className="text-muted-foreground">{act.customerName}</span>
                    <span className="px-2.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full text-xs font-semibold">{act.action}</span>
                    {act.branchName && <span className="text-xs text-muted-foreground">({act.branchName})</span>}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                    {formatDateTime(act.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </QueryBoundary>
  );
}

export default DocumentDashboardPage;
