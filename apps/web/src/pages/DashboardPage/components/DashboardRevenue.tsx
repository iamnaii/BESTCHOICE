import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardToolbar } from '@/components/ui/card';
import CompanyFilter from '@/components/CompanyFilter';
import type { LucideIcon } from 'lucide-react';
import {
  ShoppingCart,
  FileCheck,
  DollarSign,
  Users,
  Warehouse,
  BarChart3,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KPIs, MonthlyRevenue, EntityProfit } from '../types';
import { ErrorBlock } from '../types';

/* ─── Quick Action Shortcut Card ─── */
function ShortcutCard({ icon: Icon, label, path, color }: { icon: LucideIcon; label: string; path: string; color: string }) {
  const navigate = useNavigate();
  return (
    <Card
      className="cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 group border-border/60"
      onClick={() => navigate(path)}
    >
      <CardContent className="p-4 flex flex-col items-center justify-center gap-2.5 text-center min-h-[100px]">
        <div className={cn('size-12 rounded-2xl flex items-center justify-center transition-all group-hover:scale-110 group-hover:shadow-md shadow-sm', color)}>
          <Icon className="size-5 text-white" />
        </div>
        <span className="text-xs font-semibold text-foreground leading-tight">{label}</span>
      </CardContent>
    </Card>
  );
}

interface DashboardRevenueProps {
  userRole: string | undefined;
  kpis: KPIs | undefined;
  revenue: MonthlyRevenue | undefined;
  revenueError: boolean;
  refetchRevenue: () => void;
  entityProfit: EntityProfit | undefined;
  entityProfitError: boolean;
}

export default function DashboardRevenue({
  userRole,
  kpis,
  revenue,
  revenueError,
  refetchRevenue,
  entityProfit: defaultEntityProfit,
  entityProfitError: defaultEntityProfitError,
}: DashboardRevenueProps) {
  const navigate = useNavigate();
  const [companyId, setCompanyId] = useState('');

  // When a company filter is selected, re-fetch entity profit for that company
  const { data: filteredEntityProfit, isError: filteredEntityProfitError } = useQuery<EntityProfit>({
    queryKey: ['dashboard-entity-profit', companyId],
    queryFn: async () => {
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const endDate = now.toISOString().slice(0, 10);
      const params = new URLSearchParams({ startDate, endDate });
      if (companyId) params.set('companyId', companyId);
      return (await api.get(`/reports/entity-profit?${params}`)).data;
    },
    enabled: !!companyId && (userRole === 'OWNER' || userRole === 'FINANCE_MANAGER' || userRole === 'ACCOUNTANT'),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const entityProfit = companyId ? filteredEntityProfit : defaultEntityProfit;
  const entityProfitError = companyId ? filteredEntityProfitError : defaultEntityProfitError;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-7.5">
      {/* Quick Action Shortcuts -- role-based */}
      <div className="lg:col-span-5">
        <div className="grid grid-cols-2 gap-4">
          <ShortcutCard icon={ShoppingCart} label="POS ขายสินค้า" path="/pos" color="bg-blue-500" />
          <ShortcutCard icon={FileCheck} label="สัญญาผ่อน" path="/contracts" color="bg-indigo-500" />
          {(userRole !== 'SALES') && (
            <ShortcutCard icon={DollarSign} label="ชำระเงิน" path="/payments" color="bg-green-500" />
          )}
          <ShortcutCard icon={Users} label="ลูกค้า" path="/customers" color="bg-purple-500" />
          {(userRole === 'OWNER' || userRole === 'BRANCH_MANAGER') && (
            <ShortcutCard icon={Warehouse} label="คลังสินค้า" path="/stock" color="bg-orange-500" />
          )}
          {(userRole === 'OWNER' || userRole === 'BRANCH_MANAGER' || userRole === 'FINANCE_MANAGER' || userRole === 'ACCOUNTANT') && (
            <ShortcutCard icon={BarChart3} label="รายงาน" path="/reports" color="bg-cyan-500" />
          )}
        </div>
      </div>

      {/* Monthly Revenue + Financial Summary */}
      <div className="lg:col-span-7 flex flex-col gap-5">
        {/* Monthly Revenue */}
        {userRole !== 'SALES' && (
          <Card>
            <CardHeader>
              <CardTitle>รายได้เดือนนี้</CardTitle>
              <CardToolbar>
                {revenue && (
                  <span className="text-2xs text-muted-foreground bg-muted px-2.5 py-1 rounded-md font-medium">
                    {revenue.paymentCount} รายการ
                  </span>
                )}
              </CardToolbar>
            </CardHeader>
            <CardContent className="p-0">
              {revenueError ? (
                <ErrorBlock message="โหลดข้อมูลรายได้ไม่สำเร็จ" onRetry={() => refetchRevenue()} />
              ) : revenue ? (
                <div className="divide-y divide-border/50">
                  <div className="flex items-center gap-4 px-5 py-3.5">
                    <div className="w-1 h-8 rounded-full bg-blue-500" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">ยอดชำระรวม</div>
                      <div className="text-2xs text-muted-foreground">รับชำระทั้งเดือน</div>
                    </div>
                    <div className="text-sm font-semibold text-foreground">{revenue.totalPayments.toLocaleString()} ฿</div>
                  </div>
                  <div className="flex items-center gap-4 px-5 py-3.5">
                    <div className="w-1 h-8 rounded-full bg-green-500" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">ดอกเบี้ยรับ</div>
                      <div className="text-2xs text-muted-foreground">ส่วนดอกเบี้ยจากค่างวด</div>
                    </div>
                    <div className="text-sm font-semibold text-success">{revenue.interestIncome.toLocaleString()} ฿</div>
                  </div>
                  <div className="flex items-center gap-4 px-5 py-3.5">
                    <div className="w-1 h-8 rounded-full bg-yellow-500" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">ค่าปรับ</div>
                      <div className="text-2xs text-muted-foreground">ค่าปรับล่าช้าสะสม</div>
                    </div>
                    <div className="text-sm font-semibold text-warning">{revenue.lateFeeIncome.toLocaleString()} ฿</div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8 text-sm">กำลังโหลด...</div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Entity Profit: SHOP vs FINANCE */}
        {entityProfitError && (userRole === 'OWNER' || userRole === 'FINANCE_MANAGER' || userRole === 'ACCOUNTANT') && (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              ไม่สามารถโหลดข้อมูลกำไร หน้าร้าน/ไฟแนนซ์ ได้
            </CardContent>
          </Card>
        )}
        {!entityProfitError && (userRole === 'OWNER' || userRole === 'FINANCE_MANAGER' || userRole === 'ACCOUNTANT') && (
          <Card>
            <CardHeader>
              <CardTitle>กำไร หน้าร้าน / ไฟแนนซ์ เดือนนี้</CardTitle>
              <CardToolbar>
                <CompanyFilter
                  value={companyId}
                  onChange={setCompanyId}
                  className="[&_label]:hidden [&_select]:py-1 [&_select]:text-xs [&_select]:h-7"
                />
                {entityProfit && (
                  <span className="text-2xs text-muted-foreground bg-muted px-2.5 py-1 rounded-md font-medium">
                    {(entityProfit.shop?.transactionCount || 0)} รายการ
                  </span>
                )}
              </CardToolbar>
            </CardHeader>
            <CardContent className="p-0">
              {entityProfit ? (
                <div className="divide-y divide-border/50">
                  <div className="flex items-center gap-4 px-5 py-3.5">
                    <div className="w-1 h-8 rounded-full bg-blue-500" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">BESTCHOICE หน้าร้าน</div>
                      <div className="text-2xs text-muted-foreground">ดาวน์ + เงินต้น + คอมมิชชัน - ต้นทุน</div>
                    </div>
                    <div className="text-sm font-semibold text-success">
                      {(entityProfit.shop?.profit || 0).toLocaleString()} ฿
                    </div>
                  </div>
                  <div className="flex items-center gap-4 px-5 py-3.5">
                    <div className="w-1 h-8 rounded-full bg-indigo-500" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">BESTCHOICE ไฟแนนซ์</div>
                      <div className="text-2xs text-muted-foreground">ดอกเบี้ย - คอมมิชชัน + ค่าปรับ</div>
                    </div>
                    <div className="text-sm font-semibold text-success">
                      {(entityProfit.finance?.profit || 0).toLocaleString()} ฿
                    </div>
                  </div>
                  <div
                    className="flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate('/reports')}
                  >
                    <div className="w-1 h-8 rounded-full bg-green-500" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">กำไรรวม</div>
                      <div className="text-2xs text-muted-foreground">หน้าร้าน + ไฟแนนซ์ (ไม่รวม VAT)</div>
                    </div>
                    <div className="text-sm font-bold text-success">
                      {(entityProfit.combined?.totalProfit || 0).toLocaleString()} ฿
                    </div>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8 text-sm">กำลังโหลด...</div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Financial Summary */}
        {kpis && (
          <Card>
            <CardHeader>
              <CardTitle>สรุปภาพรวม</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                <div
                  className="flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigate('/contracts')}
                >
                  <div className="w-1 h-8 rounded-full bg-blue-500" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-foreground">ลูกหนี้คงค้าง</div>
                    <div className="text-2xs text-muted-foreground">ยอดค้างรับทั้งหมด</div>
                  </div>
                  <div className="text-sm font-semibold text-foreground">{kpis.financial.totalReceivable.toLocaleString()} ฿</div>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </div>
                <div
                  className="flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigate('/contracts')}
                >
                  <div className="w-1 h-8 rounded-full bg-green-500" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-foreground">ปิดสัญญาแล้ว</div>
                    <div className="text-2xs text-muted-foreground">สัญญาที่ชำระครบ</div>
                  </div>
                  <div className="text-sm font-semibold text-primary">{kpis.contracts.completed} สัญญา</div>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </div>
                <div className="flex items-center gap-4 px-5 py-3.5">
                  <div className="w-1 h-8 rounded-full bg-yellow-500" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-foreground">ค่าปรับรวม</div>
                    <div className="text-2xs text-muted-foreground">ค่าปรับสะสมทั้งหมด</div>
                  </div>
                  <div className="text-sm font-semibold text-warning">{kpis.financial.totalLateFees.toLocaleString()} ฿</div>
                </div>
                <div
                  className="flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigate('/overdue')}
                >
                  <div className="w-1 h-8 rounded-full bg-red-500" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-foreground">ค้างชำระ / ผิดนัด</div>
                    <div className="text-2xs text-muted-foreground">สัญญาที่ต้องติดตาม</div>
                  </div>
                  <div className="text-sm font-semibold">
                    <span className="text-warning">{kpis.contracts.overdue}</span>
                    <span className="text-muted-foreground mx-1">/</span>
                    <span className="text-destructive">{kpis.contracts.default}</span>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
