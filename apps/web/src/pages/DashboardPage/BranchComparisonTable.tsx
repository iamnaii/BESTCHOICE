import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardToolbar, CardTable } from '@/components/ui/card';
import QueryErrorBlock from '@/components/ui/QueryErrorBlock';

interface BranchComparison {
  id: string;
  name: string;
  contracts: number;
  activeContracts: number;
  products: number;
  users: number;
  overdueContracts: number;
  overdueRate: number;
  monthlyRevenue: number;
  collectionRate: number;
  stockTurnover: number;
}

interface BranchComparisonTableProps {
  branchData: BranchComparison[];
  branchError: boolean;
  refetchBranch: () => void;
}

export default function BranchComparisonTable({ branchData, branchError, refetchBranch }: BranchComparisonTableProps) {
  return (
    <>
      {branchError && (
        <Card>
          <CardContent>
            <QueryErrorBlock message="โหลดข้อมูลสาขาไม่สำเร็จ" onRetry={() => refetchBranch()} />
          </CardContent>
        </Card>
      )}
      {branchData.length > 0 && (
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
                  <tr className="border-b border-border/50 text-left text-muted-foreground">
                    <th className="px-5 pb-3 pt-4 font-medium text-xs">สาขา</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">สัญญา</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">รายได้/เดือน</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">อัตราเก็บเงิน</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">ค้างชำระ</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">อัตราค้าง</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">ขายได้/เดือน</th>
                  </tr>
                </thead>
                <tbody>
                  {branchData.map((b) => (
                    <tr key={b.name} className="border-b border-border/30 last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="px-5 py-3 font-medium text-foreground">
                        <div>{b.name}</div>
                        <div className="text-2xs text-muted-foreground">{b.users} คน · {b.products} สินค้า</div>
                      </td>
                      <td className="px-5 py-3 text-right text-foreground">{b.contracts}</td>
                      <td className="px-5 py-3 text-right text-success font-medium">
                        {b.monthlyRevenue.toLocaleString()} ฿
                      </td>
                      <td className="px-5 py-3 text-right">
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
                      <td className="px-5 py-3 text-right">
                        <span className={b.overdueContracts > 0 ? 'text-destructive font-semibold' : 'text-foreground'}>
                          {b.overdueContracts}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
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
                      <td className="px-5 py-3 text-right text-foreground">{b.stockTurnover} เครื่อง</td>
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
