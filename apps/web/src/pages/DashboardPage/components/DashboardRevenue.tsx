import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardToolbar } from '@/components/ui/card';
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
      className="cursor-pointer hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 group"
      onClick={() => navigate(path)}
    >
      <CardContent className="p-5 flex flex-col items-center justify-center gap-3 text-center min-h-[120px]">
        <div className={cn('size-11 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105', color)}>
          <Icon className="size-5 text-white" />
        </div>
        <span className="text-2sm font-medium text-foreground leading-tight">{label}</span>
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
  entityProfit,
  entityProfitError,
}: DashboardRevenueProps) {
  const navigate = useNavigate();

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
      <div className="lg:col-span-7 flex flex-col gap-5 lg:gap-7.5">
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
              ไม่สามารถโหลดข้อมูลกำไร Shop/Finance ได้
            </CardContent>
          </Card>
        )}
        {entityProfit && !entityProfitError && (userRole === 'OWNER' || userRole === 'FINANCE_MANAGER' || userRole === 'ACCOUNTANT') && (
          <Card>
            <CardHeader>
              <CardTitle>กำไร Shop / Finance เดือนนี้</CardTitle>
              <CardToolbar>
                <span className="text-2xs text-muted-foreground bg-muted px-2.5 py-1 rounded-md font-medium">
                  {(entityProfit.shop?.transactionCount || 0)} รายการ
                </span>
              </CardToolbar>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                <div className="flex items-center gap-4 px-5 py-3.5">
                  <div className="w-1 h-8 rounded-full bg-blue-500" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-foreground">BESTCHOICE SHOP</div>
                    <div className="text-2xs text-muted-foreground">ดาวน์ + เงินต้น + คอมมิชชัน - ต้นทุน</div>
                  </div>
                  <div className="text-sm font-semibold text-success">
                    {(entityProfit.shop?.profit || 0).toLocaleString()} ฿
                  </div>
                </div>
                <div className="flex items-center gap-4 px-5 py-3.5">
                  <div className="w-1 h-8 rounded-full bg-indigo-500" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-foreground">BESTCHOICE FINANCE</div>
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
                    <div className="text-2xs text-muted-foreground">SHOP + FINANCE (ไม่รวม VAT)</div>
                  </div>
                  <div className="text-sm font-bold text-success">
                    {(entityProfit.combined?.totalProfit || 0).toLocaleString()} ฿
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </div>
              </div>
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
