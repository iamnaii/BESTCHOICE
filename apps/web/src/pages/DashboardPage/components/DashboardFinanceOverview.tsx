import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, Bell, FileWarning, Scale, Gavel } from 'lucide-react';

interface OverdueStats {
  totalOutstanding: number;
  stages: {
    REMINDER: number;
    NOTICE: number;
    FINAL_WARNING: number;
    LEGAL_ACTION: number;
  };
}

export default function DashboardFinanceOverview() {
  const { data, isLoading } = useQuery<OverdueStats>({
    queryKey: ['dashboard-finance-overview'],
    queryFn: async () => {
      const { data } = await api.get('/overdue/stats');
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 lg:gap-5">
        {[1, 2, 3, 4].map((i) => (
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

  const stages = data.stages || { REMINDER: 0, NOTICE: 0, FINAL_WARNING: 0, LEGAL_ACTION: 0 };
  const totalContracts =
    (stages.REMINDER || 0) +
    (stages.NOTICE || 0) +
    (stages.FINAL_WARNING || 0) +
    (stages.LEGAL_ACTION || 0);

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
        ภาพรวมติดตามหนี้
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 lg:gap-5">
        <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-destructive">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="size-10 rounded-xl bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="size-5 text-destructive" />
              </div>
              <span className="text-2xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
                {totalContracts} สัญญา
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {(data.totalOutstanding || 0).toLocaleString()} ฿
            </div>
            <div className="text-2xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">
              ยอดค้างชำระรวม
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-warning">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="size-9 rounded-xl bg-warning/10 flex items-center justify-center">
                <Bell className="size-4 text-warning" />
              </div>
            </div>
            <div className="text-2xl font-bold text-foreground">{stages.REMINDER || 0}</div>
            <div className="text-2xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">
              แจ้งเตือน
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-warning">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="size-9 rounded-xl bg-warning/10 flex items-center justify-center">
                <FileWarning className="size-4 text-warning" />
              </div>
            </div>
            <div className="text-2xl font-bold text-foreground">{stages.NOTICE || 0}</div>
            <div className="text-2xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">
              แจ้งค้างชำระ
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-destructive">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="size-9 rounded-xl bg-destructive/10 flex items-center justify-center">
                <Scale className="size-4 text-destructive" />
              </div>
            </div>
            <div className="text-2xl font-bold text-foreground">{stages.FINAL_WARNING || 0}</div>
            <div className="text-2xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">
              เตือนครั้งสุดท้าย
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-destructive">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="size-9 rounded-xl bg-destructive/10 flex items-center justify-center">
                <Gavel className="size-4 text-destructive" />
              </div>
            </div>
            <div className="text-2xl font-bold text-foreground">{stages.LEGAL_ACTION || 0}</div>
            <div className="text-2xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">
              ดำเนินคดี
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
