import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardToolbar } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  BarChart3,
  Building2,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Download,
  Trophy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import QueryErrorBlock from '@/components/ui/QueryErrorBlock';

interface BranchMetrics {
  id: string;
  name: string;
  totalContracts: number;
  activeContracts: number;
  overdueContracts: number;
  defaultContracts: number;
  completedContracts: number;
  totalRevenue: number;
  totalOutstanding: number;
  collectionRate: number;
  overdueRate: number;
  newContracts: number;
}

interface BranchAnalyticsData {
  branches: BranchMetrics[];
  period: string;
  generatedAt: string;
}

type SortKey = 'name' | 'totalContracts' | 'totalRevenue' | 'collectionRate' | 'overdueRate';

const periodOptions = [
  { value: '1m', label: 'เดือนนี้' },
  { value: '3m', label: '3 เดือน' },
  { value: '6m', label: '6 เดือน' },
  { value: '1y', label: '1 ปี' },
];

export default function BranchAnalyticsPage() {
  const [period, setPeriod] = useState('1m');
  const [sortKey, setSortKey] = useState<SortKey>('totalRevenue');
  const [sortAsc, setSortAsc] = useState(false);

  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useQuery<BranchAnalyticsData>({
    queryKey: ['branch-analytics', period],
    queryFn: () => api.get(`/dashboard/analytics/branches?period=${period}`).then((r) => r.data),
  });

  const branches = useMemo(() => {
    if (!data?.branches) return [];
    return [...data.branches].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [data, sortKey, sortAsc]);

  const maxRevenue = useMemo(
    () => Math.max(...(branches.map((b) => b.totalRevenue) || [1]), 1),
    [branches],
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const bestBranch = useMemo(
    () => branches.reduce((best, b) => (b.collectionRate > (best?.collectionRate ?? 0) ? b : best), branches[0]),
    [branches],
  );
  const worstBranch = useMemo(
    () => branches.reduce((worst, b) => (b.overdueRate > (worst?.overdueRate ?? 0) ? b : worst), branches[0]),
    [branches],
  );

  const exportCsv = useCallback(() => {
    if (!branches.length) return;
    const bom = '\uFEFF';
    const headers = ['สาขา', 'สัญญาทั้งหมด', 'Active', 'ค้างชำระ', 'ผิดนัด', 'ปิดแล้ว', 'สัญญาใหม่', 'รายได้', 'ค้างรับ', 'อัตราเก็บ%', 'อัตราค้าง%'];
    const rows = branches.map((b) => [
      b.name, b.totalContracts, b.activeContracts, b.overdueContracts, b.defaultContracts,
      b.completedContracts, b.newContracts, b.totalRevenue, b.totalOutstanding,
      b.collectionRate, b.overdueRate,
    ].map((v) => `"${v}"`).join(','));
    const csv = bom + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `branch-analytics-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('ดาวน์โหลด CSV แล้ว');
  }, [branches, period]);

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <th
      className="px-3 pb-3 pt-2 font-medium text-xs text-right cursor-pointer hover:text-foreground transition-colors"
      onClick={() => handleSort(field)}
    >
      {label} {sortKey === field ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div className="flex flex-col gap-5 lg:gap-7">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="size-5" />
            เปรียบเทียบสาขา
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            วิเคราะห์ performance ระหว่างสาขา
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            {periodOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  period === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="size-3.5 mr-1.5" />
            CSV
          </Button>
        </div>
      </div>

      {isError && <QueryErrorBlock message="โหลดข้อมูลสาขาไม่สำเร็จ" onRetry={() => refetch()} />}

      {isLoading && (
        <div className="text-center text-muted-foreground py-12 text-sm">กำลังโหลด...</div>
      )}

      {branches.length > 0 && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <Building2 className="size-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-2xs text-muted-foreground">จำนวนสาขา</p>
                    <p className="text-lg font-semibold text-foreground">{branches.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                    <Trophy className="size-4 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-2xs text-muted-foreground">สาขาเก็บเงินดีสุด</p>
                    <p className="text-sm font-semibold text-foreground truncate">
                      {bestBranch?.name}
                    </p>
                    <p className="text-2xs text-success">{bestBranch?.collectionRate}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                    <TrendingUp className="size-4 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-2xs text-muted-foreground">รายได้รวม</p>
                    <p className="text-lg font-semibold text-foreground">
                      {branches.reduce((s, b) => s + b.totalRevenue, 0).toLocaleString()} ฿
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                    <AlertTriangle className="size-4 text-red-600 dark:text-red-400" />
                  </div>
                  <div>
                    <p className="text-2xs text-muted-foreground">สาขาค้างชำระสูงสุด</p>
                    <p className="text-sm font-semibold text-foreground truncate">
                      {worstBranch?.name}
                    </p>
                    <p className="text-2xs text-destructive">{worstBranch?.overdueRate}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Revenue Chart */}
          <Card>
            <CardHeader>
              <CardTitle>รายได้ตามสาขา</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {branches.map((b) => (
                  <div key={b.id} className="flex items-center gap-4">
                    <div className="w-24 text-xs font-medium text-foreground truncate shrink-0">
                      {b.name}
                    </div>
                    <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{
                          width: `${(b.totalRevenue / maxRevenue) * 100}%`,
                          minWidth: b.totalRevenue > 0 ? '8px' : '0',
                        }}
                      />
                    </div>
                    <div className="w-28 text-right text-sm font-semibold text-foreground">
                      {b.totalRevenue.toLocaleString()} ฿
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Comparison Table */}
          <Card>
            <CardHeader>
              <CardTitle>ตารางเปรียบเทียบ</CardTitle>
              <CardToolbar>
                <Badge variant="secondary" className="text-2xs">
                  {branches.length} สาขา
                </Badge>
              </CardToolbar>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 text-left text-muted-foreground">
                      <th
                        className="px-3 pb-3 pt-2 font-medium text-xs cursor-pointer hover:text-foreground"
                        onClick={() => handleSort('name')}
                      >
                        สาขา {sortKey === 'name' ? (sortAsc ? '↑' : '↓') : ''}
                      </th>
                      <SortHeader label="สัญญา" field="totalContracts" />
                      <th className="px-3 pb-3 pt-2 font-medium text-xs text-right">Active</th>
                      <th className="px-3 pb-3 pt-2 font-medium text-xs text-right">ค้างชำระ</th>
                      <th className="px-3 pb-3 pt-2 font-medium text-xs text-right">ผิดนัด</th>
                      <th className="px-3 pb-3 pt-2 font-medium text-xs text-right">ใหม่</th>
                      <SortHeader label="รายได้" field="totalRevenue" />
                      <SortHeader label="อัตราเก็บ%" field="collectionRate" />
                      <SortHeader label="อัตราค้าง%" field="overdueRate" />
                    </tr>
                  </thead>
                  <tbody>
                    {branches.map((b) => (
                      <tr
                        key={b.id}
                        className="border-b border-border/30 last:border-0 hover:bg-muted/50 transition-colors"
                      >
                        <td className="px-3 py-2.5 font-medium text-foreground">{b.name}</td>
                        <td className="px-3 py-2.5 text-right text-foreground">{b.totalContracts}</td>
                        <td className="px-3 py-2.5 text-right text-foreground">{b.activeContracts}</td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={b.overdueContracts > 0 ? 'text-warning font-semibold' : 'text-foreground'}>
                            {b.overdueContracts}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={b.defaultContracts > 0 ? 'text-destructive font-semibold' : 'text-foreground'}>
                            {b.defaultContracts}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-primary font-medium">
                          {b.newContracts}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium text-foreground">
                          {b.totalRevenue.toLocaleString()} ฿
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded-md text-2xs font-medium',
                              b.collectionRate >= 80
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : b.collectionRate >= 60
                                  ? 'bg-warning/10 text-warning'
                                  : 'bg-destructive/10 text-destructive',
                            )}
                          >
                            {b.collectionRate}%
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded-md text-2xs font-medium',
                              b.overdueRate > 20
                                ? 'bg-destructive/10 text-destructive'
                                : b.overdueRate > 10
                                  ? 'bg-warning/10 text-warning'
                                  : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
                            )}
                          >
                            {b.overdueRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
