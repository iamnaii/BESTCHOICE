import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ArrowRightLeft, Monitor, Wrench, Sofa, Car, Package } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { formatDateShortThai, formatNumberDecimal } from '@/utils/formatters';
import { assetsApi } from './api';
import { CATEGORY_LABEL, type AssetCategory } from './types';
import type { SummaryRow, AssetTransferRow } from './types';

const today = () => new Date().toISOString().slice(0, 10);

const CATEGORY_ICON: Record<AssetCategory, LucideIcon> = {
  EQUIPMENT: Monitor,
  IMPROVEMENT: Wrench,
  FURNITURE: Sofa,
  VEHICLE: Car,
};

function isAssetCategory(key: string): key is AssetCategory {
  return key === 'EQUIPMENT' || key === 'IMPROVEMENT' || key === 'FURNITURE' || key === 'VEHICLE';
}

function CategoryGroupCards({ data }: { data: SummaryRow[] }) {
  const grandTotal = useMemo(() => {
    return data.reduce(
      (acc, r) => ({
        count: acc.count + r.count,
        totalPurchaseCost: acc.totalPurchaseCost + parseFloat(r.totalPurchaseCost || '0'),
        totalAccumulatedDepr: acc.totalAccumulatedDepr + parseFloat(r.totalAccumulatedDepr || '0'),
        totalNbv: acc.totalNbv + parseFloat(r.totalNbv || '0'),
      }),
      { count: 0, totalPurchaseCost: 0, totalAccumulatedDepr: 0, totalNbv: 0 },
    );
  }, [data]);

  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          ไม่มีข้อมูลสินทรัพย์ ณ วันที่นี้
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {data.map((row) => {
        const Icon = isAssetCategory(row.key) ? CATEGORY_ICON[row.key] : Package;
        const label = isAssetCategory(row.key) ? CATEGORY_LABEL[row.key] : row.label;
        return (
          <Card key={row.key}>
            <CardHeader className="flex flex-row items-center justify-between gap-4 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold">{label}</h3>
                  <p className="text-xs text-muted-foreground">{row.count} รายการ</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-6 text-right">
                <div>
                  <p className="text-xs text-muted-foreground">ราคาทุน</p>
                  <p className="font-semibold tabular-nums">
                    {formatNumberDecimal(parseFloat(row.totalPurchaseCost))}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">ค่าเสื่อมสะสม</p>
                  <p className="font-semibold tabular-nums">
                    {formatNumberDecimal(parseFloat(row.totalAccumulatedDepr))}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">มูลค่าตามบัญชีสุทธิ (NBV)</p>
                  <p className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatNumberDecimal(parseFloat(row.totalNbv))}
                  </p>
                </div>
              </div>
            </CardHeader>
          </Card>
        );
      })}

      <Card className="bg-muted/30 border-primary/30">
        <CardContent className="p-4">
          <div className="flex flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold">รวมทั้งหมด</h3>
              <p className="text-xs text-muted-foreground">{grandTotal.count} รายการ</p>
            </div>
            <div className="grid grid-cols-3 gap-6 text-right">
              <div>
                <p className="text-xs text-muted-foreground">ราคาทุนรวม</p>
                <p className="font-semibold tabular-nums">
                  {formatNumberDecimal(grandTotal.totalPurchaseCost)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">ค่าเสื่อมสะสมรวม</p>
                <p className="font-semibold tabular-nums">
                  {formatNumberDecimal(grandTotal.totalAccumulatedDepr)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">มูลค่าตามบัญชีสุทธิ (NBV) รวม</p>
                <p className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatNumberDecimal(grandTotal.totalNbv)}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

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
      label: 'มูลค่าตามบัญชีสุทธิ (NBV)',
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
    queryKey: ['asset-transfers-recent', asOfDate],
    queryFn: () =>
      assetsApi.listAllTransfers({
        limit: 100,
        toDate: asOfDate, // bound by asOfDate — only show transfers ≤ asOfDate
      }),
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
            <CategoryGroupCards data={summaryQuery.data ?? []} />
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
                {(movementQuery.data?.total ?? 0) > 100 && (
                  <p className="text-sm text-muted-foreground text-center mt-4">
                    แสดง 100 รายการล่าสุดจากทั้งหมด {movementQuery.data?.total} รายการ ·{' '}
                    <Link to="/assets/transfers" className="text-primary underline">
                      ดูทั้งหมด →
                    </Link>
                  </p>
                )}
              </CardContent>
            </Card>
          </QueryBoundary>
        </TabsContent>
      </Tabs>
    </div>
  );
}
