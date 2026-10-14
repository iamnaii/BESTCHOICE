import { formatNumberDecimal } from '@/utils/formatters';
import EmptyState from '@/components/ui/EmptyState';
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
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';
import type { MonthlyTrend, StatusDistribution } from '../types';
import { statusLabels, statusColors, pieColors, ErrorBlock } from '../types';

const trendConfig = {
  newContracts: { label: 'สัญญาใหม่ (สัญญา)', color: 'hsl(var(--chart-1))' },
  paymentsReceived: { label: 'ยอดชำระ (บาท)', color: 'hsl(var(--chart-4))' },
} satisfies ChartConfig;

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
  const totalStatusCount = useMemo(
    () => statusDist.reduce((sum, s) => sum + s.count, 0),
    [statusDist],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Monthly Trend -- Recharts AreaChart */}
      <div className="lg:col-span-7">
        <Card>
          <CardHeader>
            <CardTitle>แนวโน้ม 12 เดือน</CardTitle>
            <CardToolbar>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {Object.entries(trendConfig).map(([key, series]) => (
                  <span key={key} className="flex items-center gap-1.5">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: series.color }}
                    />
                    {series.label}
                  </span>
                ))}
              </div>
            </CardToolbar>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-muted-foreground">แกนซ้าย: จำนวนสัญญา · แกนขวา: บาท</p>
            {trendError ? (
              <ErrorBlock message="โหลดข้อมูลไม่สำเร็จ" onRetry={() => refetchTrend()} />
            ) : trend.length > 0 ? (
              <ChartContainer
                aria-label="สัญญาใหม่ใช้แกนซ้าย หน่วยสัญญา ยอดชำระใช้แกนขวา หน่วยบาท"
                config={trendConfig}
                className="h-[280px] w-full"
              >
                <AreaChart data={trend} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradContracts" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-newContracts)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-newContracts)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradPayments" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor="var(--color-paymentsReceived)"
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor="var(--color-paymentsReceived)"
                        stopOpacity={0}
                      />
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
                    yAxisId="contracts"
                    width={36}
                    allowDecimals={false}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="payments"
                    orientation="right"
                    width={54}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value: number) =>
                      new Intl.NumberFormat('th-TH', { notation: 'compact' }).format(value)
                    }
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="newContracts"
                    yAxisId="contracts"
                    name={trendConfig.newContracts.label}
                    stroke="var(--color-newContracts)"
                    strokeWidth={2}
                    fill="url(#gradContracts)"
                  />
                  <Area
                    type="monotone"
                    dataKey="paymentsReceived"
                    yAxisId="payments"
                    name={trendConfig.paymentsReceived.label}
                    stroke="var(--color-paymentsReceived)"
                    strokeWidth={2}
                    fill="url(#gradPayments)"
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <EmptyState
                title="ยังไม่มีข้อมูลในช่วงนี้"
                description="ข้อมูลจะแสดงเมื่อมีรายการในช่วงเวลาที่เลือก"
                className="min-h-[280px] py-8"
              />
            )}
            {!trendError && trend.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer min-h-11 py-3 text-primary">
                  ดูข้อมูลกราฟเป็นตาราง
                </summary>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-90 text-sm [&_th]:px-2 [&_td]:px-2 [&_th]:py-2 [&_td]:py-1">
                    <caption className="sr-only">แนวโน้มรายเดือน แยกจำนวนสัญญาและยอดชำระ</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="text-left">
                          เดือน
                        </th>
                        <th scope="col" className="text-right">
                          สัญญาใหม่ (สัญญา)
                        </th>
                        <th scope="col" className="text-right">
                          ยอดชำระ (บาท)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {trend.map((row) => (
                        <tr key={row.month}>
                          <th scope="row" className="text-left font-normal">
                            {row.month}
                          </th>
                          <td className="text-right tabular-nums">
                            {row.newContracts.toLocaleString('th-TH')}
                          </td>
                          <td className="text-right tabular-nums">
                            {formatNumberDecimal(row.paymentsReceived, 2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
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
                        <Cell
                          key={s.status}
                          fill={pieColors[s.status] || 'hsl(var(--muted-foreground))'}
                        />
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
                        <span
                          className={cn(
                            'size-2 rounded-full',
                            statusColors[s.status] || 'bg-muted-foreground',
                          )}
                        />
                        {statusLabels[s.status] || s.status}
                      </div>
                      <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full opacity-80',
                            statusColors[s.status] || 'bg-muted-foreground',
                          )}
                          style={{
                            width:
                              totalStatusCount > 0
                                ? `${(s.count / totalStatusCount) * 100}%`
                                : '0%',
                            minWidth: s.count > 0 ? '8px' : '0',
                          }}
                        />
                      </div>
                      <div className="w-10 text-right text-2sm font-semibold text-foreground">
                        {s.count}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState
                title="ยังไม่มีข้อมูลในช่วงนี้"
                description="ข้อมูลจะแสดงเมื่อมีรายการในช่วงเวลาที่เลือก"
                className="min-h-[280px] py-8"
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
