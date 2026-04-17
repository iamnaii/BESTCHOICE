import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardToolbar } from '@/components/ui/card';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';
import type { MonthlyTrend, StatusDistribution } from '../types';
import { statusLabels, statusColors, pieColors, ErrorBlock } from '../types';

interface DashboardChartsProps {
  trend: MonthlyTrend[];
  trendError: boolean;
  refetchTrend: () => void;
  statusDist: StatusDistribution[];
  statusDistError: boolean;
  refetchStatusDist: () => void;
}

export default function DashboardCharts({
  trend,
  trendError,
  refetchTrend,
  statusDist,
  statusDistError,
  refetchStatusDist,
}: DashboardChartsProps) {
  const totalStatusCount = useMemo(() => statusDist.reduce((sum, s) => sum + s.count, 0), [statusDist]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Monthly Trend -- Recharts AreaChart */}
      <div className="lg:col-span-7">
        <Card>
          <CardHeader>
            <CardTitle>แนวโน้ม 12 เดือน</CardTitle>
            <CardToolbar>
              <div className="flex gap-4 text-2xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 bg-primary rounded-full inline-block" /> สัญญาใหม่
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 bg-success rounded-full inline-block" /> ยอดชำระ
                </span>
              </div>
            </CardToolbar>
          </CardHeader>
          <CardContent>
            {trendError ? (
              <ErrorBlock message="โหลดข้อมูลไม่สำเร็จ" onRetry={() => refetchTrend()} />
            ) : trend.length > 0 ? (
              <ChartContainer
                config={{
                  newContracts: { label: 'สัญญาใหม่', color: 'hsl(var(--chart-1))' },
                  paymentsReceived: { label: 'ยอดชำระ (฿)', color: 'hsl(var(--chart-4))' },
                } satisfies ChartConfig}
                className="h-[280px] w-full"
              >
                <AreaChart data={trend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradContracts" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-newContracts)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-newContracts)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradPayments" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-paymentsReceived)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-paymentsReceived)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="newContracts"
                    name="สัญญาใหม่"
                    stroke="var(--color-newContracts)"
                    strokeWidth={2}
                    fill="url(#gradContracts)"
                  />
                  <Area
                    type="monotone"
                    dataKey="paymentsReceived"
                    name="ยอดชำระ (฿)"
                    stroke="var(--color-paymentsReceived)"
                    strokeWidth={2}
                    fill="url(#gradPayments)"
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <div className="text-center text-muted-foreground py-8 text-sm">ไม่มีข้อมูล</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Status Distribution -- PieChart + legend bars */}
      <div className="lg:col-span-5">
        <Card>
          <CardHeader>
            <CardTitle>สถานะสัญญา</CardTitle>
            <CardToolbar>
              <span className="text-2xs text-muted-foreground bg-muted px-2.5 py-1 rounded-md font-medium">
                ทั้งหมด {totalStatusCount}
              </span>
            </CardToolbar>
          </CardHeader>
          <CardContent>
            {statusDistError ? (
              <ErrorBlock message="โหลดข้อมูลไม่สำเร็จ" onRetry={() => refetchStatusDist()} />
            ) : statusDist.length > 0 ? (
              <div>
                {/* Donut chart */}
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={statusDist.map((s) => ({
                        name: statusLabels[s.status] || s.status,
                        value: s.count,
                        fill: pieColors[s.status] || 'hsl(var(--muted-foreground))',
                      }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {statusDist.map((s) => (
                        <Cell key={s.status} fill={pieColors[s.status] || 'hsl(var(--muted-foreground))'} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>

                {/* Legend bars */}
                <div className="space-y-2.5 mt-2">
                  {statusDist.map((s) => (
                    <div key={s.status} className="flex items-center gap-3">
                      <div className="w-24 text-xs text-foreground font-medium flex items-center gap-2">
                        <span className={cn('size-2 rounded-full', statusColors[s.status] || 'bg-muted-foreground')} />
                        {statusLabels[s.status] || s.status}
                      </div>
                      <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                        <div
                          className={cn('h-full rounded-full opacity-80', statusColors[s.status] || 'bg-muted-foreground')}
                          style={{
                            width: totalStatusCount > 0 ? `${(s.count / totalStatusCount) * 100}%` : '0%',
                            minWidth: s.count > 0 ? '8px' : '0',
                          }}
                        />
                      </div>
                      <div className="w-10 text-right text-2sm font-semibold text-foreground">{s.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8 text-sm">ไม่มีข้อมูล</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
