import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardToolbar } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  FileCheck,
  DollarSign,
  UserCheck,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgingSummary, StaffPerformance } from '../types';
import { agingBarColors, agingTextColors, ErrorBlock, timeAgo } from '../types';

interface DashboardStaffProps {
  userRole: string | undefined;
  aging: AgingSummary | undefined;
  agingError: boolean;
  refetchAging: () => void;
  staffPerf: StaffPerformance | undefined;
  staffError: boolean;
  refetchStaff: () => void;
}

export default function DashboardStaff({
  userRole,
  aging,
  agingError,
  refetchAging,
  staffPerf,
  staffError,
  refetchStaff,
}: DashboardStaffProps) {
  const agingMax = useMemo(() => (aging ? Math.max(...aging.buckets.map((b) => b.amount), 1) : 1), [aging]);

  return (
    <>
      {/* Aging Buckets -- hide for SALES */}
      {userRole !== 'SALES' && <Card>
        <CardHeader>
          <CardTitle>อายุหนี้ค้างชำระ (Aging)</CardTitle>
          <CardToolbar>
            {aging && (
              <span className="text-2xs text-destructive bg-destructive/10 px-2.5 py-1 rounded-md font-medium">
                {aging.total.count} รายการ — {aging.total.amount.toLocaleString()} ฿
              </span>
            )}
          </CardToolbar>
        </CardHeader>
        <CardContent>
          {agingError ? (
            <ErrorBlock message="โหลดข้อมูลอายุหนี้ไม่สำเร็จ" onRetry={() => refetchAging()} />
          ) : aging ? (
            <div className="space-y-4">
              {aging.buckets.map((bucket) => (
                <div key={bucket.range} className="flex items-center gap-4">
                  <div className="w-16 text-xs font-medium text-foreground shrink-0">{bucket.range} วัน</div>
                  <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                    <div
                      className={cn('h-full rounded-full opacity-80', agingBarColors[bucket.color] || 'bg-zinc-400')}
                      style={{
                        width: agingMax > 0 ? `${(bucket.amount / agingMax) * 100}%` : '0%',
                        minWidth: bucket.amount > 0 ? '8px' : '0',
                      }}
                    />
                  </div>
                  <div className="w-14 text-right text-xs font-medium text-muted-foreground">{bucket.count} รายการ</div>
                  <div className={cn('w-28 text-right text-sm font-semibold', agingTextColors[bucket.color] || 'text-foreground')}>
                    {bucket.amount.toLocaleString()} ฿
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8 text-sm">กำลังโหลด...</div>
          )}
        </CardContent>
      </Card>}

      {/* Staff Performance (Tabs) -- OWNER only */}
      {userRole === 'OWNER' && <Card>
        <CardHeader>
          <CardTitle>กำกับพนักงาน</CardTitle>
          <CardToolbar>
            {staffPerf && (
              <span className="text-2xs text-muted-foreground bg-muted px-2.5 py-1 rounded-md font-medium">
                เดือนนี้
              </span>
            )}
          </CardToolbar>
        </CardHeader>
        <CardContent>
          {staffError ? (
            <ErrorBlock message="โหลดข้อมูลพนักงานไม่สำเร็จ" onRetry={() => refetchStaff()} />
          ) : staffPerf ? (
            <Tabs defaultValue="sales">
              <TabsList variant="line" size="sm">
                <TabsTrigger value="sales">
                  <UserCheck className="size-3.5" />
                  ยอดขายรายคน
                </TabsTrigger>
                <TabsTrigger value="activity">
                  <Clock className="size-3.5" />
                  กิจกรรมล่าสุด
                </TabsTrigger>
              </TabsList>

              {/* Tab: Sales by person */}
              <TabsContent value="sales">
                {staffPerf.salesMetrics.length > 0 ? (
                  <div className="overflow-x-auto -mx-1">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
                          <th className="px-3 pb-3 pt-2 font-medium text-xs">พนักงาน</th>
                          <th className="px-3 pb-3 pt-2 font-medium text-xs">สาขา</th>
                          <th className="px-3 pb-3 pt-2 font-medium text-xs text-right">สัญญา</th>
                          <th className="px-3 pb-3 pt-2 font-medium text-xs text-right">ยอดขาย</th>
                          <th className="px-3 pb-3 pt-2 font-medium text-xs text-right">ค้างชำระ</th>
                          <th className="px-3 pb-3 pt-2 font-medium text-xs text-right">อัตราค้าง</th>
                        </tr>
                      </thead>
                      <tbody>
                        {staffPerf.salesMetrics.map((s) => (
                          <tr key={s.salespersonId} className="border-b border-border/30 last:border-0 hover:bg-muted/50 transition-colors">
                            <td className="px-3 py-2.5 font-medium text-foreground">{s.name}</td>
                            <td className="px-3 py-2.5 text-muted-foreground">{s.branch}</td>
                            <td className="px-3 py-2.5 text-right text-foreground">{s.totalContracts}</td>
                            <td className="px-3 py-2.5 text-right text-foreground font-medium">{s.totalSales.toLocaleString()} ฿</td>
                            <td className="px-3 py-2.5 text-right">
                              <span className={s.overdueCount > 0 ? 'text-destructive font-semibold' : 'text-foreground'}>
                                {s.overdueCount}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <span
                                className={cn(
                                  'px-2 py-0.5 rounded-md text-2xs font-medium',
                                  s.overdueRate > 20
                                    ? 'bg-destructive/10 text-destructive'
                                    : s.overdueRate > 10
                                      ? 'bg-warning/10 text-warning'
                                      : 'bg-success/10 text-success dark:bg-success/15 dark:bg-green-900/30 dark:text-green-400',
                                )}
                              >
                                {s.overdueRate}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-8 text-sm">ยังไม่มีข้อมูลเดือนนี้</div>
                )}
              </TabsContent>

              {/* Tab: Recent Activity */}
              <TabsContent value="activity">
                {staffPerf.recentActivity.length > 0 ? (
                  <div className="space-y-1">
                    {staffPerf.recentActivity.map((a) => (
                      <div key={`${a.type}-${a.id}`} className="flex items-start gap-3 py-2.5 border-b border-border/30 last:border-0">
                        <div className={cn(
                          'size-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                          a.type === 'contract_created' ? 'bg-primary/10' : 'bg-success/10',
                        )}>
                          {a.type === 'contract_created'
                            ? <FileCheck className="size-4 text-primary" />
                            : <DollarSign className="size-4 text-success" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-foreground">
                            <span className="font-medium">{a.userName}</span>{' '}
                            <span className="text-muted-foreground">{a.description}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-2xs text-muted-foreground">{timeAgo(a.createdAt)}</span>
                          </div>
                        </div>
                        <div className="text-sm font-semibold text-foreground shrink-0">
                          {a.amount.toLocaleString()} ฿
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-8 text-sm">ยังไม่มีกิจกรรมใน 7 วันที่ผ่านมา</div>
                )}
              </TabsContent>
            </Tabs>
          ) : (
            <div className="text-center text-muted-foreground py-8 text-sm">กำลังโหลด...</div>
          )}
        </CardContent>
      </Card>}
    </>
  );
}
