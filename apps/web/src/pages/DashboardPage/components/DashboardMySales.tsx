import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { ShoppingCart, DollarSign, Clock } from 'lucide-react';

interface CommissionSummary {
  totalSalesCount: number;
  totalSalesAmount: number;
  totalCommission: number;
  pendingCount: number;
  approvedCount: number;
  paidCount: number;
}

export default function DashboardMySales() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery<CommissionSummary>({
    queryKey: ['dashboard-my-sales', user?.id],
    queryFn: async () => {
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const endDate = now.toISOString().slice(0, 10);
      const { data } = await api.get(
        `/commissions?salespersonId=me&startDate=${startDate}&endDate=${endDate}`,
      );
      // Compute summary from response
      const commissions = data.data || data || [];
      const list = Array.isArray(commissions) ? commissions : [];
      return {
        totalSalesCount: list.length,
        totalSalesAmount: list.reduce(
          (sum: number, c: { saleAmount?: number }) => sum + (Number(c.saleAmount) || 0),
          0,
        ),
        totalCommission: list.reduce(
          (sum: number, c: { commissionAmount?: number; amount?: number }) =>
            sum + (Number(c.commissionAmount ?? c.amount) || 0),
          0,
        ),
        pendingCount: list.filter((c: { status?: string }) => c.status === 'PENDING').length,
        approvedCount: list.filter((c: { status?: string }) => c.status === 'APPROVED').length,
        paidCount: list.filter((c: { status?: string }) => c.status === 'PAID').length,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-5">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-5">
              <div className="h-4 w-24 bg-muted rounded mb-3" />
              <div className="h-8 w-32 bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
        ยอดขายของฉัน
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-5">
        <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-primary">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <ShoppingCart className="size-5 text-primary" />
              </div>
              <span className="text-2xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
                {data.totalSalesCount} รายการ
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {data.totalSalesAmount.toLocaleString()} ฿
            </div>
            <div className="text-2xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">
              ยอดขายเดือนนี้
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-success">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="size-10 rounded-xl bg-success/10 flex items-center justify-center">
                <DollarSign className="size-5 text-success" />
              </div>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {data.totalCommission.toLocaleString()} ฿
            </div>
            <div className="text-2xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">
              คอมมิชชันเดือนนี้
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-warning">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="size-10 rounded-xl bg-warning/10 flex items-center justify-center">
                <Clock className="size-5 text-warning" />
              </div>
            </div>
            <div className="text-lg font-bold text-foreground">
              <span className="text-warning">{data.pendingCount}</span>
              {' / '}
              <span className="text-primary">{data.approvedCount}</span>
              {' / '}
              <span className="text-success">{data.paidCount}</span>
            </div>
            <div className="text-2xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">
              รอ / อนุมัติ / จ่ายแล้ว
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
