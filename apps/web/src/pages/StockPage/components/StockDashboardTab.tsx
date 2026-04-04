import { StockDashboard } from '../types';
import { statusLabels, categoryLabels } from '@/lib/constants';
import AnimatedCounter from '@/components/ui/animated-counter';
import { formatDateShort } from '@/utils/formatters';

export interface StockDashboardTabProps {
  dashboard: StockDashboard | undefined;
  isManager: boolean;
  actionTotal: number;
  warrantyExpiring: { id: string; name: string; brand: string; model: string; warrantyExpireDate: string }[];
}

// --- Small Reusable Components (only used in dashboard) ---

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-foreground mb-3">{children}</h2>;
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className={`rounded-xl border p-4 transition-shadow hover:shadow-xs ${accent ? `border-l-4 ${accent}` : ''}`}>
      <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{label}</div>
      <div className="text-xl font-bold text-foreground">
        {typeof value === 'number' ? <AnimatedCounter value={value} /> : value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function BarInline({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-24 truncate text-muted-foreground" title={label}>{label}</span>
      <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <span className="w-8 text-right text-foreground font-medium">{count}</span>
    </div>
  );
}

export function StockDashboardTab({ dashboard, isManager, actionTotal, warrantyExpiring }: StockDashboardTabProps) {
  return (
    <>
      {warrantyExpiring.length > 0 && (
        <div className="bg-warning/5 dark:bg-warning/10 border border-warning/20 rounded-xl p-4 mb-4">
          <div className="text-sm font-medium text-warning">
            รับประกันใกล้หมด: {warrantyExpiring.length} รายการ
          </div>
          <div className="mt-2 space-y-1">
            {warrantyExpiring.slice(0, 5).map(p => (
              <div key={p.id} className="text-xs text-warning/80 flex justify-between">
                <span>{p.brand} {p.model}</span>
                <span>{formatDateShort(p.warrantyExpireDate)}</span>
              </div>
            ))}
            {warrantyExpiring.length > 5 && <div className="text-xs text-warning/70">...และอีก {warrantyExpiring.length - 5} รายการ</div>}
          </div>
        </div>
      )}

      {dashboard && (
        <div className="flex flex-col gap-5 lg:gap-7.5">

          {/* Row 1: Action Required + Stock Turnover */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-7.5">
            {/* Action Required */}
            <div className="rounded-lg border p-5">
              <SectionTitle>รอดำเนินการ ({actionTotal})</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                {dashboard.actionRequired.inspection > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-warning/5 dark:bg-warning/10 rounded-xl">
                    <div className="w-10 h-10 bg-warning/10 rounded-xl flex items-center justify-center text-warning text-lg font-bold">
                      {dashboard.actionRequired.inspection}
                    </div>
                    <div className="text-sm text-warning">รอตรวจสอบ</div>
                  </div>
                )}
                {(dashboard.actionRequired.photoPending || 0) > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-primary/5 dark:bg-primary/10 rounded-xl">
                    <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary text-lg font-bold">
                      {dashboard.actionRequired.photoPending}
                    </div>
                    <div className="text-sm text-primary-700">รอถ่ายรูป</div>
                  </div>
                )}
                {dashboard.actionRequired.pendingTransfers > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-primary-50 rounded-lg">
                    <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center text-primary text-lg font-bold">
                      {dashboard.actionRequired.pendingTransfers}
                    </div>
                    <div className="text-sm text-primary-700">รอยืนยันโอน</div>
                  </div>
                )}
                {dashboard.actionRequired.repossessed > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-destructive/5 dark:bg-destructive/10 rounded-lg">
                    <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center text-red-600 text-lg font-bold">
                      {dashboard.actionRequired.repossessed}
                    </div>
                    <div className="text-sm text-destructive">ยึดคืน รอปรับสภาพ</div>
                  </div>
                )}
                {dashboard.actionRequired.agingOver90 > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-orange-50 rounded-lg">
                    <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 text-lg font-bold">
                      {dashboard.actionRequired.agingOver90}
                    </div>
                    <div className="text-sm text-orange-700">ค้างสต๊อค 90+ วัน</div>
                  </div>
                )}
                {actionTotal === 0 && (
                  <div className="col-span-2 text-center text-sm text-muted-foreground py-4">ไม่มีรายการรอดำเนินการ</div>
                )}
              </div>
            </div>

            {/* Stock Turnover */}
            <div className="rounded-lg border p-5">
              <SectionTitle>อัตราหมุนเวียนสต๊อค</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <StatCard label="อายุเฉลี่ยในสต๊อค" value={`${dashboard.stockTurnover.avgDaysInStock} วัน`} accent="border-l-primary-500" />
                <StatCard label="สต๊อคปัจจุบัน" value={dashboard.stockTurnover.currentStock} sub="ชิ้น (IN_STOCK)" accent="border-l-green-500" />
                <StatCard label="ขายเดือนนี้" value={dashboard.stockTurnover.soldThisMonth} sub="ชิ้น" accent="border-l-indigo-500" />
                <StatCard label="ขายเดือนที่แล้ว" value={dashboard.stockTurnover.soldLastMonth} sub="ชิ้น" accent="border-l-gray-400" />
              </div>
            </div>
          </div>

          {/* Row 2: Stock Aging */}
          <div className="rounded-lg border p-5">
            <SectionTitle>อายุสต๊อค (Stock Aging)</SectionTitle>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {dashboard.stockAging.map((bucket, i) => {
                const colors = ['border-l-green-500', 'border-l-yellow-500', 'border-l-orange-500', 'border-l-red-500'];
                return (
                  <div key={bucket.label} className={`bg-muted rounded-lg p-4 border-l-4 ${colors[i]}`}>
                    <div className="text-sm font-medium text-foreground">{bucket.label}</div>
                    <div className="text-2xl font-bold text-foreground mt-1">{bucket.count} <span className="text-sm font-normal text-muted-foreground">ชิ้น</span></div>
                    <div className="text-xs text-muted-foreground mt-1">{bucket.value.toLocaleString()} ฿</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Row 3: Value by Status + Stock Movement */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-7.5">
            {/* Value by Status */}
            <div className="rounded-lg border p-5">
              <SectionTitle>มูลค่าสต๊อคตามสถานะ</SectionTitle>
              <div className="space-y-2">
                {dashboard.valueByStatus.map((item) => {
                  const s = statusLabels[item.status] || { label: item.status, className: 'bg-muted text-foreground' };
                  return (
                    <div key={item.status} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>
                        <span className="text-sm text-muted-foreground">{item.count} ชิ้น</span>
                      </div>
                      <span className="text-sm font-medium text-foreground">{item.value.toLocaleString()} ฿</span>
                    </div>
                  );
                })}
                {dashboard.valueByStatus.length > 0 && (
                  <div className="flex items-center justify-between pt-2 border-t border-border font-medium">
                    <span className="text-sm text-foreground">รวมทั้งหมด</span>
                    <span className="text-sm text-foreground">
                      {dashboard.valueByStatus.reduce((s, i) => s + i.value, 0).toLocaleString()} ฿
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Stock Movement */}
            <div className="rounded-lg border p-5">
              <SectionTitle>การเคลื่อนไหวสต๊อค (6 เดือน)</SectionTitle>
              <div className="space-y-3">
                <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-400 inline-block" /> รับเข้า</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-indigo-400 inline-block" /> ขายออก</span>
                </div>
                {(() => {
                  const maxVal = Math.max(...dashboard.stockMovement.map((x) => Math.max(x.in, x.out)), 1);
                  return dashboard.stockMovement.map((m) => (
                    <div key={m.month} className="space-y-1">
                      <div className="text-xs text-muted-foreground font-medium">{m.month}</div>
                      <div className="flex items-center gap-2">
                        <div className="w-12 text-xs text-right text-success">{m.in}</div>
                        <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
                          <div className="h-full bg-green-400 rounded-full" style={{ width: `${(m.in / maxVal) * 100}%` }} />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-12 text-xs text-right text-indigo-600">{m.out}</div>
                        <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
                          <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${(m.out / maxVal) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>

          {/* Row 4: Category + Brand + Color + Storage Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-7.5">
            {/* By Category */}
            <div className="rounded-lg border p-5">
              <SectionTitle>ตามประเภท</SectionTitle>
              <div className="space-y-2">
                {dashboard.byCategory.map((item) => (
                  <BarInline
                    key={item.name}
                    label={categoryLabels[item.name] || item.name}
                    count={item.count}
                    total={dashboard.stockTurnover.currentStock}
                    color="bg-primary-400"
                  />
                ))}
                {dashboard.byCategory.length === 0 && <div className="text-sm text-muted-foreground text-center py-2">-</div>}
              </div>
            </div>

            {/* By Brand */}
            <div className="rounded-lg border p-5">
              <SectionTitle>ตามแบรนด์</SectionTitle>
              <div className="space-y-2">
                {dashboard.byBrand.slice(0, 8).map((item) => (
                  <BarInline
                    key={item.name}
                    label={item.name}
                    count={item.count}
                    total={dashboard.stockTurnover.currentStock}
                    color="bg-primary-400"
                  />
                ))}
                {dashboard.byBrand.length === 0 && <div className="text-sm text-muted-foreground text-center py-2">-</div>}
              </div>
            </div>

            {/* By Color */}
            <div className="rounded-lg border p-5">
              <SectionTitle>ตามสี</SectionTitle>
              <div className="space-y-2">
                {dashboard.byColor.slice(0, 8).map((item) => (
                  <BarInline
                    key={item.name}
                    label={item.name}
                    count={item.count}
                    total={dashboard.stockTurnover.currentStock}
                    color="bg-pink-400"
                  />
                ))}
                {dashboard.byColor.length === 0 && <div className="text-sm text-muted-foreground text-center py-2">-</div>}
              </div>
            </div>

            {/* By Storage */}
            <div className="rounded-lg border p-5">
              <SectionTitle>ตามความจุ</SectionTitle>
              <div className="space-y-2">
                {dashboard.byStorage.slice(0, 8).map((item) => (
                  <BarInline
                    key={item.name}
                    label={item.name}
                    count={item.count}
                    total={dashboard.stockTurnover.currentStock}
                    color="bg-teal-400"
                  />
                ))}
                {dashboard.byStorage.length === 0 && <div className="text-sm text-muted-foreground text-center py-2">-</div>}
              </div>
            </div>
          </div>

          {/* Row 5: Margin Overview -- Owner/Manager only */}
          {isManager && (
            <div className="rounded-lg border p-5">
              <SectionTitle>กำไรเฉลี่ย (Margin Overview) - สินค้าพร้อมขาย</SectionTitle>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  label="มูลค่าทุนรวม"
                  value={`${dashboard.marginOverview.totalCost.toLocaleString()} ฿`}
                  accent="border-l-gray-400"
                />
                <StatCard
                  label="มูลค่าขายรวม"
                  value={`${dashboard.marginOverview.totalSell.toLocaleString()} ฿`}
                  accent="border-l-primary-500"
                />
                <StatCard
                  label="กำไรรวม (ถ้าขายหมด)"
                  value={`${dashboard.marginOverview.totalMargin.toLocaleString()} ฿`}
                  sub={`Margin ${dashboard.marginOverview.avgMarginPct}%`}
                  accent="border-l-green-500"
                />
                <StatCard
                  label="กำไรเฉลี่ย/ชิ้น"
                  value={`${dashboard.marginOverview.avgMarginPerUnit.toLocaleString()} ฿`}
                  sub={`จาก ${dashboard.marginOverview.itemsWithPrice} ชิ้นที่มีราคาขาย`}
                  accent="border-l-indigo-500"
                />
              </div>
            </div>
          )}

          {/* Row 7: Top Sellers + Slow Movers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-7.5">
            {/* Top Sellers */}
            <div className="rounded-lg border p-5">
              <SectionTitle>สินค้าขายดี (6 เดือนล่าสุด)</SectionTitle>
              {dashboard.topSellers.length > 0 ? (
                <div className="space-y-2">
                  {dashboard.topSellers.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        i === 0 ? 'bg-warning/10 text-warning dark:bg-warning/15' :
                        i === 1 ? 'bg-muted text-muted-foreground' :
                        i === 2 ? 'bg-warning/10 text-warning dark:bg-warning/15' :
                        'bg-muted text-muted-foreground'
                      }`}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{item.name}</div>
                      </div>
                      <span className="text-sm font-bold text-indigo-600">{item.count} ชิ้น</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-4">ยังไม่มีข้อมูลการขาย</div>
              )}
            </div>

            {/* Slow Movers */}
            <div className="rounded-lg border p-5">
              <SectionTitle>สินค้าค้างสต๊อคนานสุด</SectionTitle>
              {dashboard.slowMovers.length > 0 ? (
                <div className="space-y-2">
                  {dashboard.slowMovers.map((item, i) => (
                    <div key={`${item.name}-${i}`} className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        item.days > 90 ? 'bg-destructive/10 text-destructive dark:bg-destructive/15' :
                        item.days > 60 ? 'bg-warning/10 text-warning dark:bg-warning/15' :
                        'bg-warning/10 text-warning dark:bg-warning/15'
                      }`}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{item.name}</div>
                        {isManager && <div className="text-xs text-muted-foreground">{(Number(item.costPrice) || 0).toLocaleString()} ฿</div>}
                      </div>
                      <span className={`text-sm font-bold ${item.days > 90 ? 'text-destructive' : item.days > 60 ? 'text-warning' : 'text-yellow-600'}`}>
                        {item.days} วัน
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-4">ไม่มีสินค้าในสต๊อค</div>
              )}
            </div>
          </div>
        </div>
      )}

      {!dashboard && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-3"></div>
          กำลังโหลด Dashboard...
        </div>
      )}
    </>
  );
}
