import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ArrowRightLeft } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { formatDateShortThai, formatNumberDecimal } from '@/utils/formatters';
import { assetsApi } from './api';
import type { SummaryRow, AssetTransferRow } from './types';

const today = () => new Date().toISOString().slice(0, 10);

function SummaryTable({ data }: { data: SummaryRow[] }) {
  const columns = [
    { key: 'label', label: 'หมวด', render: (r: SummaryRow) => r.label },
    {
      key: 'count',
      label: 'จำนวน',
      render: (r: SummaryRow) => <span className="tabular-nums">{r.count}</span>,
    },
    {
      key: 'totalPurchaseCost',
      label: 'ราคาทุน',
      render: (r: SummaryRow) => (
        <span className="tabular-nums">{formatNumberDecimal(parseFloat(r.totalPurchaseCost))}</span>
      ),
    },
    {
      key: 'totalAccumulatedDepr',
      label: 'ค่าเสื่อมสะสม',
      render: (r: SummaryRow) => (
        <span className="tabular-nums">
          {formatNumberDecimal(parseFloat(r.totalAccumulatedDepr))}
        </span>
      ),
    },
    {
      key: 'totalNbv',
      label: 'NBV',
      render: (r: SummaryRow) => (
        <span className="tabular-nums font-semibold">
          {formatNumberDecimal(parseFloat(r.totalNbv))}
        </span>
      ),
    },
  ];
  return (
    <DataTable<SummaryRow & { id: string }>
      columns={columns}
      data={data.map((r) => ({ ...r, id: r.key }))}
    />
  );
}

export default function AssetSummaryReportPage() {
  const [asOfDate, setAsOfDate] = useState(today());
  const [tab, setTab] = useState<'category' | 'custodian' | 'location' | 'movement'>('category');

  const summaryQuery = useQuery({
    queryKey: ['asset-summary', { groupBy: tab, asOfDate }],
    queryFn: () =>
      assetsApi.summaryReport({
        groupBy: tab as 'category' | 'custodian' | 'location',
        asOfDate,
      }),
    enabled: tab !== 'movement',
  });

  const movementQuery = useQuery({
    queryKey: ['asset-transfers-recent'],
    queryFn: () => assetsApi.listAllTransfers({ limit: 100 }),
    enabled: tab === 'movement',
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="รายงานสรุปสินทรัพย์"
        subtitle={`ณ วันที่ ${formatDateShortThai(asOfDate)}`}
        icon={<BarChart3 className="h-5 w-5" />}
      />

      <Card>
        <CardContent className="p-4">
          <label className="text-sm font-medium mb-1 block">ณ วันที่</label>
          <div className="max-w-xs">
            <ThaiDateInput
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value || today())}
            />
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="category">หมวดหมู่</TabsTrigger>
          <TabsTrigger value="custodian">ผู้ดูแล</TabsTrigger>
          <TabsTrigger value="location">ที่ตั้ง</TabsTrigger>
          <TabsTrigger value="movement">การเคลื่อนไหว</TabsTrigger>
        </TabsList>

        <TabsContent value="category">
          <QueryBoundary
            isLoading={summaryQuery.isLoading}
            isError={summaryQuery.isError}
            error={summaryQuery.error}
            onRetry={() => summaryQuery.refetch()}
          >
            <SummaryTable data={summaryQuery.data ?? []} />
          </QueryBoundary>
        </TabsContent>
        <TabsContent value="custodian">
          <QueryBoundary
            isLoading={summaryQuery.isLoading}
            isError={summaryQuery.isError}
            error={summaryQuery.error}
            onRetry={() => summaryQuery.refetch()}
          >
            <SummaryTable data={summaryQuery.data ?? []} />
          </QueryBoundary>
        </TabsContent>
        <TabsContent value="location">
          <QueryBoundary
            isLoading={summaryQuery.isLoading}
            isError={summaryQuery.isError}
            error={summaryQuery.error}
            onRetry={() => summaryQuery.refetch()}
          >
            <SummaryTable data={summaryQuery.data ?? []} />
          </QueryBoundary>
        </TabsContent>
        <TabsContent value="movement">
          <QueryBoundary
            isLoading={movementQuery.isLoading}
            isError={movementQuery.isError}
            error={movementQuery.error}
            onRetry={() => movementQuery.refetch()}
            errorTitle="โหลดประวัติการเคลื่อนไหวไม่สำเร็จ"
          >
            <Card>
              <CardContent className="p-4">
                <ul className="space-y-3">
                  {(movementQuery.data?.data ?? []).map((t: AssetTransferRow) => (
                    <li
                      key={t.id}
                      className="flex gap-3 items-start border-l-2 border-primary pl-3"
                    >
                      <ArrowRightLeft className="h-4 w-4 text-muted-foreground mt-1" />
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          {formatDateShortThai(t.transferDate)} —{' '}
                          <span className="font-mono">{t.asset.assetCode}</span> {t.asset.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t.fromCustodian !== t.toCustodian && (
                            <span>
                              ผู้ดูแล: {t.fromCustodian ?? '-'} →{' '}
                              <strong>{t.toCustodian ?? '-'}</strong>
                            </span>
                          )}
                          {t.fromLocation !== t.toLocation && (
                            <span>
                              {' '}
                              · ที่ตั้ง: {t.fromLocation ?? '-'} →{' '}
                              <strong>{t.toLocation ?? '-'}</strong>
                            </span>
                          )}
                        </div>
                        <div className="text-xs italic mt-1">
                          {t.reason} — {t.transferredBy.name}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </QueryBoundary>
        </TabsContent>
      </Tabs>
    </div>
  );
}
