// Depreciation page — manual run + history (Phase 2)
// Cron auto-runs at 01:00 BKK on the last day of each month; this page
// is for catch-up / manual control + reversal of past runs.

import { useState, useMemo, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Decimal from 'decimal.js';
import { TrendingDown, Undo2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { formatNumberDecimal, formatDateTime, formatMonthName } from '@/utils/formatters';
import { getErrorMessage } from '@/lib/api';
import { depreciationApi } from './api';
import { DepreciationPreviewTable } from './components/DepreciationPreviewTable';
import { DepreciationRunDialog } from './components/DepreciationRunDialog';
import { ReverseDepreciationRunDialog } from './components/ReverseDepreciationRunDialog';
import type { DepreciationRunSummary } from './types';

// DataTable requires T extends { id: string } — map period→id for safety.
type RunRow = DepreciationRunSummary & { id: string };

function lastTwelveMonths(): { value: string; label: string }[] {
  const result: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    // Use พ.ศ. (Buddhist year) — Thai accounting convention. toLocaleDateString
    // returns ค.ศ. on some Node/browser locales which is wrong for our UI.
    const label = `${formatMonthName(d)} ${d.getFullYear() + 543}`;
    result.push({ value, label });
  }
  return result;
}

export default function DepreciationPage() {
  const queryClient = useQueryClient();
  const months = useMemo(() => lastTwelveMonths(), []);
  const [selectedPeriod, setSelectedPeriod] = useState(months[0].value);
  const [showRun, setShowRun] = useState(false);
  const [reverseTargetPeriod, setReverseTargetPeriod] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['depreciation-runs'],
    queryFn: () => depreciationApi.list(),
  });

  const previewQuery = useQuery({
    queryKey: ['depreciation-preview', selectedPeriod],
    queryFn: () => depreciationApi.preview(selectedPeriod),
    enabled: !!selectedPeriod,
  });

  const runMutation = useMutation({
    mutationFn: (period: string) => depreciationApi.run(period),
    onSuccess: (result) => {
      toast.success(
        `รันค่าเสื่อมเสร็จ ${result.assetCount} สินทรัพย์ (${formatNumberDecimal(new Decimal(result.totalAmount).toNumber())} บาท)`,
      );
      queryClient.invalidateQueries({ queryKey: ['depreciation-runs'] });
      queryClient.invalidateQueries({ queryKey: ['depreciation-preview'] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets-summary'] });
      setShowRun(false);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const reverseMutation = useMutation({
    mutationFn: ({ period, reason }: { period: string; reason: string }) =>
      depreciationApi.reverse(period, reason),
    onSuccess: (r) => {
      toast.success(`กลับรายการ ${r.reversedCount} entries`);
      queryClient.invalidateQueries({ queryKey: ['depreciation-runs'] });
      queryClient.invalidateQueries({ queryKey: ['depreciation-preview'] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets-summary'] });
      setReverseTargetPeriod(null);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const tableData: RunRow[] = useMemo(
    () => (listQuery.data ?? []).map((r) => ({ ...r, id: r.period })),
    [listQuery.data],
  );

  const columns = useMemo(
    () => [
      {
        key: 'period',
        label: 'งวด',
        render: (row: RunRow): ReactNode => <span className="font-mono">{row.period}</span>,
      },
      {
        key: 'totalAmount',
        label: 'ยอดรวม',
        render: (row: RunRow): ReactNode => (
          <span className="tabular-nums">{formatNumberDecimal(new Decimal(row.totalAmount).toNumber())}</span>
        ),
      },
      {
        key: 'assetCount',
        label: 'จำนวนสินทรัพย์',
        render: (row: RunRow): ReactNode => row.assetCount,
      },
      {
        key: 'ranAt',
        label: 'รันเมื่อ',
        render: (row: RunRow): ReactNode => formatDateTime(row.ranAt),
      },
      {
        key: 'status',
        label: 'สถานะ',
        render: (row: RunRow): ReactNode => (
          <Badge variant={row.status === 'POSTED' ? 'success' : 'outline'}>
            {row.status === 'POSTED' ? 'ลงบัญชีแล้ว' : 'กลับรายการ'}
          </Badge>
        ),
      },
      {
        key: 'action',
        label: 'จัดการ',
        sortable: false,
        render: (row: RunRow): ReactNode =>
          row.status === 'POSTED' ? (
            <Button
              size="icon"
              mode="icon"
              variant="ghost"
              aria-label="กลับรายการ"
              onClick={() => setReverseTargetPeriod(row.period)}
            >
              <Undo2 className="size-4" />
            </Button>
          ) : null,
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="ค่าเสื่อมราคา"
        subtitle="Auto-run cron 01:00 BKK ทุกสิ้นเดือน · Manual run สำหรับ catch-up"
        icon={<TrendingDown className="size-5" />}
      />

      <Card>
        <CardHeader>
          <CardTitle>1. รัน Manual</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-xs">
              <label className="block text-sm font-medium mb-1">งวด</label>
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label} ({m.value})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => setShowRun(true)}
              disabled={!previewQuery.data || previewQuery.data.assetCount === 0}
            >
              รันค่าเสื่อมงวดนี้
            </Button>
          </div>
          <QueryBoundary
            isLoading={previewQuery.isLoading}
            isError={previewQuery.isError}
            error={previewQuery.error}
            onRetry={() => previewQuery.refetch()}
            errorTitle="โหลด preview ไม่สำเร็จ"
          >
            {previewQuery.data && <DepreciationPreviewTable preview={previewQuery.data} />}
          </QueryBoundary>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. ประวัติการรัน</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryBoundary
            isLoading={listQuery.isLoading}
            isError={listQuery.isError}
            error={listQuery.error}
            onRetry={() => listQuery.refetch()}
            errorTitle="โหลดประวัติไม่สำเร็จ"
          >
            <DataTable
              columns={columns}
              data={tableData}
              emptyMessage="ยังไม่มีประวัติการรันค่าเสื่อม"
            />
          </QueryBoundary>
        </CardContent>
      </Card>

      {previewQuery.data && (
        <DepreciationRunDialog
          open={showRun}
          onOpenChange={setShowRun}
          period={selectedPeriod}
          totalAmount={new Decimal(previewQuery.data.totalAmount).toNumber()}
          assetCount={previewQuery.data.assetCount}
          onConfirm={() => runMutation.mutate(selectedPeriod)}
          isPending={runMutation.isPending}
        />
      )}
      {reverseTargetPeriod && (
        <ReverseDepreciationRunDialog
          open={!!reverseTargetPeriod}
          onOpenChange={(open) => {
            if (!open) setReverseTargetPeriod(null);
          }}
          period={reverseTargetPeriod}
          onConfirm={(reason) =>
            reverseMutation.mutate({ period: reverseTargetPeriod, reason })
          }
          isPending={reverseMutation.isPending}
        />
      )}
    </div>
  );
}
