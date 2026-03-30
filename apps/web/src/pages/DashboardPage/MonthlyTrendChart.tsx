import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardToolbar } from '@/components/ui/card';
import QueryErrorBlock from '@/components/ui/QueryErrorBlock';

interface MonthlyTrend {
  month: string;
  newContracts: number;
  paymentsReceived: number;
}

interface MonthlyTrendChartProps {
  trend: MonthlyTrend[];
  trendError: boolean;
  refetchTrend: () => void;
}

export default function MonthlyTrendChart({ trend, trendError, refetchTrend }: MonthlyTrendChartProps) {
  const trendMax = useMemo(() => {
    if (trend.length === 0) return 1;
    return Math.max(...trend.map((t) => Math.max(t.newContracts, t.paymentsReceived)), 1);
  }, [trend]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>แนวโน้ม 12 เดือน</CardTitle>
        <CardToolbar>
          <span className="text-2xs text-muted-foreground">Latest trends</span>
        </CardToolbar>
      </CardHeader>
      <CardContent>
        {trendError ? (
          <QueryErrorBlock message="โหลดข้อมูลไม่สำเร็จ" onRetry={() => refetchTrend()} />
        ) : trend.length > 0 ? (
          <div className="space-y-2">
            {trend.map((t) => (
              <div key={t.month} className="flex items-center gap-3 text-xs">
                <div className="w-14 text-muted-foreground shrink-0 font-medium">{t.month}</div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2.5 bg-primary rounded-full"
                      style={{ width: `${(t.newContracts / trendMax) * 100}%`, minWidth: '2px' }}
                    />
                    <span className="text-foreground font-medium">{t.newContracts}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2.5 bg-success rounded-full"
                      style={{ width: `${(t.paymentsReceived / trendMax) * 100}%`, minWidth: '2px' }}
                    />
                    <span className="text-foreground font-medium">{t.paymentsReceived.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ))}
            <div className="flex gap-4 text-2xs text-muted-foreground mt-4 pt-3 border-t border-border/50">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 bg-primary rounded-full inline-block" /> สัญญาใหม่
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 bg-success rounded-full inline-block" /> ยอดชำระ (บาท)
              </span>
            </div>
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-8 text-sm">ไม่มีข้อมูล</div>
        )}
      </CardContent>
    </Card>
  );
}
