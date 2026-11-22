import { useState, type ReactNode } from 'react';
import { Package, Smartphone, Wallet, Clock, TrendingUp } from 'lucide-react';
import type { StockInventoryScope } from '@installment/shared';
import { StockDashboard } from '../types';
import { StockSalesSourcesDialog } from './StockSalesSourcesDialog';

export interface StockHeroKpiProps {
  totalInStock: number | null;
  totalValue: number | null;
  dashboard: StockDashboard | undefined;
  isManager: boolean;
  inventoryScope?: StockInventoryScope;
}
function Metric({
  label,
  icon,
  value,
  unit,
  children,
  primary = false,
}: {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  unit?: string;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <article
      className={`rounded-xl border p-4 sm:p-5 min-h-44 ${primary ? 'border-primary/25 bg-primary/5' : 'border-border bg-card'}`}
    >
      <div className="flex items-start justify-between gap-2 min-h-10 text-sm text-muted-foreground">
        <span>{label}</span>
        <span className="text-primary shrink-0 [&>svg]:size-5">{icon}</span>
      </div>
      <div className="flex items-baseline gap-2 my-3">
        <strong
          className={`text-3xl sm:text-4xl font-semibold tabular-nums ${primary ? 'text-primary' : ''}`}
        >
          {value}
        </strong>
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
      <div className="text-sm text-muted-foreground leading-snug">{children}</div>
    </article>
  );
}
export function StockHeroKpi({
  totalInStock,
  totalValue,
  dashboard,
  isManager,
  inventoryScope = 'all',
}: StockHeroKpiProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const unit = inventoryScope === 'devices' ? 'เครื่อง' : 'ชิ้น';
  const analytics = dashboard?.salesAnalytics;
  const hasSales = analytics ? analytics.nativeIncluded || analytics.importedIncluded : !!dashboard;
  const margin = dashboard?.marginOverview;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      <Metric
        primary
        label={
          inventoryScope === 'devices'
            ? 'เครื่องพร้อมขาย'
            : inventoryScope === 'accessories'
              ? 'อุปกรณ์เสริมพร้อมจ่าย'
              : 'พร้อมขาย'
        }
        icon={inventoryScope === 'devices' ? <Smartphone /> : <Package />}
        value={totalInStock?.toLocaleString() ?? '—'}
        unit={unit}
      >
        {totalValue != null && <>ต้นทุน {totalValue.toLocaleString()} ฿</>}
        {totalInStock === 0 && <p>ไม่มีสินค้าพร้อมขายในกลุ่มนี้</p>}
      </Metric>
      <Metric
        label={
          inventoryScope === 'accessories'
            ? 'จ่ายอุปกรณ์เดือนนี้'
            : inventoryScope === 'all'
              ? 'ขาย / จ่ายเดือนนี้'
              : 'ขายเดือนนี้'
        }
        icon={<TrendingUp />}
        value={hasSales ? (dashboard?.stockTurnover.soldThisMonth ?? 0).toLocaleString() : '—'}
        unit={unit}
      >
        {analytics && hasSales && (
          <p>ยอดขาย {Number(analytics.current.revenue).toLocaleString()} ฿</p>
        )}
        {analytics && analytics.current.giftCount > 0 && (
          <p>รวมของแถม {analytics.current.giftCount.toLocaleString()} ชิ้น</p>
        )}
        {analytics && hasSales ? (
          <button
            className="min-h-11 text-primary underline underline-offset-4 text-sm text-left"
            onClick={() => setSourcesOpen(true)}
          >
            {analytics.importedIncluded ? 'รวม Tooltify · ' : ''}ดูที่มาของยอด
          </button>
        ) : null}
        {!hasSales && <p>{dashboard ? 'ไม่มีสิทธิ์ดูยอดขาย' : 'ยังโหลดสถิติขายไม่ได้'}</p>}
        {analytics && hasSales && (
          <p className="mt-1">
            เดือนก่อนเต็มเดือน {analytics.previous.count.toLocaleString()} {unit} ·
            เดือนนี้ถึงวันนี้
          </p>
        )}
      </Metric>
      <Metric
        label={inventoryScope === 'devices' ? 'อายุเครื่องเฉลี่ย' : 'อายุสต๊อกเฉลี่ย'}
        icon={<Clock />}
        value={
          totalInStock != null && totalInStock > 0
            ? (dashboard?.stockTurnover.avgDaysInStock ?? '—')
            : '—'
        }
        unit="วัน"
      >
        เฉพาะสินค้าพร้อมขาย
      </Metric>
      {isManager && (
        <Metric
          label="MARGIN เฉลี่ย"
          icon={<Wallet />}
          value={margin && margin.itemsWithPrice > 0 ? (margin.avgMarginPct ?? '—') : '—'}
          unit={
            margin && margin.itemsWithPrice > 0 && margin.avgMarginPct != null ? '%' : undefined
          }
        >
          {margin && margin.itemsWithPrice > 0 ? (
            <>
              {margin.totalCost != null && <>ทุน {margin.totalCost.toLocaleString()} → </>}
              {margin.totalSell != null && <>ราคาขาย {margin.totalSell.toLocaleString()} ฿</>}
              <br />
              เฉพาะรายการที่มีราคาขาย
            </>
          ) : (
            <span>ไม่มีราคาขายสำหรับคำนวณ</span>
          )}
        </Metric>
      )}
      {analytics && hasSales && (
        <StockSalesSourcesDialog
          open={sourcesOpen}
          onOpenChange={setSourcesOpen}
          analytics={analytics}
          unit={unit}
        />
      )}
    </div>
  );
}
