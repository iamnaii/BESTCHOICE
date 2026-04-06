import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardToolbar, CardTable } from '@/components/ui/card';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  TopOverdue,
  CollectionPipeline,
  BranchComparison,
} from '../types';
import { ErrorBlock } from '../types';

/** Map dunning stage to query param for /overdue drill-down */
const stageToDunning: Record<string, string> = {
  NONE: '',
  REMINDER: 'REMINDER',
  NOTICE: 'NOTICE',
  FINAL_WARNING: 'FINAL_WARNING',
  LEGAL_ACTION: 'LEGAL_ACTION',
};

interface DashboardTablesProps {
  userRole: string | undefined;
  topOverdue: TopOverdue[];
  topOverdueError: boolean;
  refetchTopOverdue: () => void;
  collectionPipeline: CollectionPipeline | undefined;
  pipelineError: boolean;
  refetchPipeline: () => void;
  branchData: BranchComparison[];
  branchError: boolean;
  refetchBranch: () => void;
}

export default function DashboardTables({
  userRole,
  topOverdue,
  topOverdueError,
  refetchTopOverdue,
  collectionPipeline,
  pipelineError,
  refetchPipeline,
  branchData,
  branchError,
  refetchBranch,
}: DashboardTablesProps) {
  const navigate = useNavigate();

  return (
    <>
      {/* Top Overdue Table */}
      {topOverdueError && (
        <Card>
          <CardContent>
            <ErrorBlock message="โหลดข้อมูลค้างชำระไม่สำเร็จ" onRetry={() => refetchTopOverdue()} />
          </CardContent>
        </Card>
      )}
      {topOverdue.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>สัญญาค้างชำระสูงสุด (Top 10)</CardTitle>
            <CardToolbar>
              <span className="text-2xs text-destructive bg-destructive/10 px-2.5 py-1 rounded-md font-medium">
                {topOverdue.length} รายการ
              </span>
            </CardToolbar>
          </CardHeader>
          <CardTable>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
                    <th className="px-5 pb-3 pt-4 font-medium text-xs">เลขสัญญา</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs">ลูกค้า</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs">เบอร์โทร</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">ยอดค้าง (บาท)</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">เกินกำหนด</th>
                  </tr>
                </thead>
                <tbody>
                  {topOverdue.map((item) => (
                    <tr key={item.contractNumber} className="border-b border-border/30 last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="px-5 py-3 font-medium text-primary">{item.contractNumber}</td>
                      <td className="px-5 py-3 text-foreground">{item.customer.name}</td>
                      <td className="px-5 py-3 text-muted-foreground">{item.customer.phone}</td>
                      <td className="px-5 py-3 text-right text-destructive font-semibold">
                        {item.totalOutstanding.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded-md text-2xs font-medium',
                            item.daysOverdue > 60
                              ? 'bg-destructive/10 text-destructive'
                              : item.daysOverdue > 30
                                ? 'bg-warning/10 text-warning'
                                : 'bg-warning/10 text-warning dark:bg-warning/15 dark:bg-orange-900/30 dark:text-orange-400',
                          )}
                        >
                          {item.daysOverdue} วัน
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardTable>
        </Card>
      )}

      {/* Collection Pipeline */}
      {pipelineError && (
        <Card>
          <CardContent>
            <ErrorBlock message="โหลดข้อมูล collection pipeline ไม่สำเร็จ" onRetry={() => refetchPipeline()} />
          </CardContent>
        </Card>
      )}
      {collectionPipeline && collectionPipeline.totalContracts > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="size-4 text-muted-foreground" />
              Collection Pipeline
            </CardTitle>
            <CardToolbar>
              <span className="text-2xs text-destructive bg-destructive/10 px-2.5 py-1 rounded-md font-medium">
                {collectionPipeline.totalContracts} สัญญา
              </span>
            </CardToolbar>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              {collectionPipeline.stages.filter((s) => s.count > 0).map((stage) => {
                const pct = collectionPipeline.totalContracts > 0
                  ? Math.round((stage.count / collectionPipeline.totalContracts) * 100)
                  : 0;
                const stageColors: Record<string, { bar: string; badge: string; text: string }> = {
                  NONE:          { bar: 'bg-muted-foreground/40', badge: 'bg-muted/60 text-muted-foreground', text: 'text-muted-foreground' },
                  REMINDER:      { bar: 'bg-yellow-400', badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', text: 'text-yellow-600 dark:text-yellow-400' },
                  NOTICE:        { bar: 'bg-orange-400', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', text: 'text-orange-600 dark:text-orange-400' },
                  FINAL_WARNING: { bar: 'bg-destructive/80', badge: 'bg-destructive/10 text-destructive', text: 'text-destructive' },
                  LEGAL_ACTION:  { bar: 'bg-destructive', badge: 'bg-destructive/20 text-destructive font-bold', text: 'text-destructive font-semibold' },
                };
                const colors = stageColors[stage.stage] ?? stageColors['NONE'];
                const dunningParam = stageToDunning[stage.stage];
                const drillDownUrl = dunningParam
                  ? `/overdue?dunningStage=${dunningParam}`
                  : '/overdue';
                return (
                  <div
                    key={stage.stage}
                    className="flex items-center gap-3 cursor-pointer rounded-lg px-1 -mx-1 py-1 hover:bg-muted/50 transition-colors"
                    onClick={() => navigate(drillDownUrl)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(drillDownUrl); }}
                  >
                    <div className="w-44 shrink-0">
                      <span className={cn('text-xs', colors.text)}>{stage.label}</span>
                    </div>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all duration-500', colors.bar)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-2 shrink-0 min-w-[120px] justify-end">
                      <span className={cn('text-xs px-2 py-0.5 rounded-md', colors.badge)}>
                        {stage.count} สัญญา
                      </span>
                      <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
              <span>ยอดค้างชำระรวม</span>
              <span className="font-semibold text-destructive text-sm">
                {collectionPipeline.totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 0 })} บาท
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Branch Comparison (OWNER only) */}
      {userRole === 'OWNER' && branchError && (
        <Card>
          <CardContent>
            <ErrorBlock message="โหลดข้อมูลสาขาไม่สำเร็จ" onRetry={() => refetchBranch()} />
          </CardContent>
        </Card>
      )}
      {userRole === 'OWNER' && branchData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>เปรียบเทียบสาขา</CardTitle>
            <CardToolbar>
              <span className="text-2xs text-muted-foreground bg-muted px-2.5 py-1 rounded-md font-medium">
                {branchData.length} สาขา
              </span>
            </CardToolbar>
          </CardHeader>
          <CardTable>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
                    <th className="px-5 pb-3 pt-4 font-medium text-xs">สาขา</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">สัญญา</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">สินค้า</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">พนักงาน</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">ค้างชำระ</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">ยอดชำระ/เดือน</th>
                  </tr>
                </thead>
                <tbody>
                  {branchData.map((b) => (
                    <tr key={b.name} className="border-b border-border/30 last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="px-5 py-3 font-medium text-foreground">{b.name}</td>
                      <td className="px-5 py-3 text-right text-foreground">{b.contracts}</td>
                      <td className="px-5 py-3 text-right text-foreground">{b.products}</td>
                      <td className="px-5 py-3 text-right text-foreground">{b.users}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={b.overdueContracts > 0 ? 'text-destructive font-semibold' : 'text-foreground'}>
                          {b.overdueContracts}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-success font-medium">
                        {b.monthlyPayments.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardTable>
        </Card>
      )}
    </>
  );
}
