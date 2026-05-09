import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { TrendingDown } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import QueryBoundary from '@/components/QueryBoundary';
import { formatDateShortThai, formatNumberDecimal } from '@/utils/formatters';
import { assetsApi } from './api';
import type { AssetScheduleRow } from './types';

export default function AssetSchedulePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['asset-schedule', id],
    queryFn: () => assetsApi.getSchedule(id!),
    enabled: !!id,
  });

  if (!id) return null;

  const currentMonth = new Date().toISOString().slice(0, 7);

  return (
    <div className="space-y-4">
      <PageHeader
        title="ตารางค่าเสื่อมราคา"
        subtitle={query.data ? `${query.data.assetCode} — ${query.data.name}` : ''}
        icon={<TrendingDown className="h-5 w-5" />}
        onBack={() => navigate(`/assets/${id}`)}
      />

      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        errorTitle="โหลดตารางค่าเสื่อมไม่สำเร็จ"
      >
        {query.data && (
          <>
            <Card>
              <CardHeader><CardTitle>ข้อมูลสินทรัพย์</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">ราคาทุน</dt>
                    <dd className="tabular-nums">{formatNumberDecimal(parseFloat(query.data.purchaseCost))}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">มูลค่าซาก</dt>
                    <dd className="tabular-nums">{formatNumberDecimal(parseFloat(query.data.residualValue))}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">ค่าเสื่อม/เดือน</dt>
                    <dd className="tabular-nums">{formatNumberDecimal(parseFloat(query.data.monthlyDepr))}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">วันที่ซื้อ</dt>
                    <dd>{formatDateShortThai(query.data.purchaseDate)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>ตาราง NBV รายเดือน ({query.data.rows.length} เดือน)</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2">งวด</th>
                      <th className="text-right py-2 px-2">ค่าเสื่อม</th>
                      <th className="text-right py-2 px-2">ค่าเสื่อมสะสม</th>
                      <th className="text-right py-2 px-2">NBV</th>
                      <th className="text-left py-2 px-2">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.rows.map((r: AssetScheduleRow) => {
                      const isCurrent = r.period === currentMonth;
                      return (
                        <tr key={r.period} className={`border-b ${isCurrent ? 'bg-muted/40' : ''}`}>
                          <td className="py-2 px-2 font-mono">{r.period}{isCurrent ? ' ←' : ''}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{formatNumberDecimal(parseFloat(r.monthlyDepr))}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{formatNumberDecimal(parseFloat(r.accumulatedDepr))}</td>
                          <td className="py-2 px-2 text-right tabular-nums font-semibold">{formatNumberDecimal(parseFloat(r.netBookValue))}</td>
                          <td className="py-2 px-2">
                            <Badge variant={r.status === 'ACTIVE' ? 'success' : 'outline'}>
                              {r.status === 'ACTIVE' ? 'ใช้งาน' : 'หักครบ'}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </QueryBoundary>
    </div>
  );
}
