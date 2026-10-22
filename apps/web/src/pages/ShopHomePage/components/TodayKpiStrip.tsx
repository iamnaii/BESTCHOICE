import { Link } from 'react-router';
import { CalendarDays, TrendingUp, Wallet, Wrench } from 'lucide-react';
import type { ShopHomeResponse } from '../types';
import { baht, thaiDateShort, timeHHMM } from '../format';

interface KpiCardProps {
  to: string;
  label: string;
  icon: React.ReactNode;
  value: string;
  unit: string;
  note: React.ReactNode;
}

function KpiCard({ to, label, icon, value, unit, note }: KpiCardProps) {
  return (
    <Link
      to={to}
      className="rounded-xl border border-border/60 bg-card p-4 flex flex-col gap-2.5 min-w-0 text-foreground transition-colors hover:border-primary/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
        <span className="text-muted-foreground [&>svg]:size-4" aria-hidden="true">{icon}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tabular-nums leading-none">{value}</span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      <div className="text-xs tabular-nums leading-snug">{note}</div>
    </Link>
  );
}

/** การ์ด "วันนี้" 4 ใบ — ทุกใบกดไปหน้าที่เกี่ยวข้อง (spec §4 ข้อ 2) */
export default function TodayKpiStrip({ today }: { today: ShopHomeResponse['today'] }) {
  const { sales, cashDrawer, bookingsExpiringToday: bk, afterSales } = today;
  const drawerNote = cashDrawer.closedToday ? (
    <span className="text-muted-foreground">
      ปิดยอดแล้ว{cashDrawer.lastClosedAt ? ` ${timeHHMM(cashDrawer.lastClosedAt)}` : ''}
    </span>
  ) : (
    <span className="text-warning-strong">
      ยังไม่ปิดยอดวันนี้
      {cashDrawer.lastClosedAt
        ? ` · ปิดยอดล่าสุด ${thaiDateShort(cashDrawer.lastClosedAt)} ${timeHHMM(cashDrawer.lastClosedAt)}`
        : ''}
    </span>
  );

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiCard
        to="/sales"
        label="ยอดขายวันนี้"
        icon={<TrendingUp />}
        value={baht(sales.netAmount)}
        unit="฿"
        note={
          <span className="text-muted-foreground">
            {`${sales.count} บิล · ขายสด ${sales.cash} · ผ่อน ${sales.installment} · ไฟแนนซ์นอก ${sales.externalFinance}`}
          </span>
        }
      />
      <KpiCard
        to="/shop/daily-cash"
        label="เงินสดในลิ้นชัก"
        icon={<Wallet />}
        value={baht(cashDrawer.balance)}
        unit="฿"
        note={drawerNote}
      />
      <KpiCard
        to="/bookings"
        label="ใบจองหมดอายุวันนี้"
        icon={<CalendarDays />}
        value={String(bk.count)}
        unit="ใบ"
        note={
          <span className="text-muted-foreground">
            {`มัดจำรวม ${baht(bk.depositTotal)} ฿ · จ่ายมัดจำแล้ว ${bk.reservedUnits} ใบ · ควรตามลูกค้า`}
          </span>
        }
      />
      <KpiCard
        to="/after-sales"
        label="หลังการขายรอลูกค้ารับ"
        icon={<Wrench />}
        value={String(afterSales.waitingPickup)}
        unit="เคส"
        note={
          afterSales.overdue > 0 ? (
            <span className="text-destructive">{`เกินกำหนดนัด ${afterSales.overdue} เคส`}</span>
          ) : (
            <span className="text-muted-foreground">ไม่มีเคสเกินนัด</span>
          )
        }
      />
    </div>
  );
}
