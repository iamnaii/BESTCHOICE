import { useEffect, useRef } from 'react';
import { getErrorMessage } from '@/lib/api';
import { useCashCloseOverview } from './cash-close-overview.query';
import { DAY_STATE_ICON, DAY_STATE_ORDER, DAY_STATE_SHORT, DAY_STATE_TILE, thaiDayMonth, weekdayShort } from './cash-hero';
import { DAY_STATE_LABEL, type CashCloseDayState } from './cash-close';

/**
 * แถบ 14 วันของสาขาเดียว = ตัวเลือกวัน (mockup CnXmYLkT กระดาน 15) — หนึ่งช่องต่อวัน มีไอคอนของสถานะเสมอ (ไม่บอกด้วยสีอย่างเดียว)
 * บรรทัดใต้แถบนับจำนวนวันของแต่ละสถานะและทำหน้าที่เป็นคำอธิบายไอคอนไปในตัว. มือถือ = เลื่อนแนวนอน เริ่มที่วันล่าสุด
 */
const LEGEND_TONE: Record<CashCloseDayState, string> = {
  REACHED: 'text-primary',
  AWAITING_CONFIRM: 'text-foreground',
  AT_BRANCH: 'text-foreground',
  MISSED: 'font-semibold text-destructive',
  NOT_COUNTED: 'text-foreground',
  NO_CASH: 'text-muted-foreground',
};

export default function CashDayStrip({ date, branchId, onPick }: { date: string; branchId: string; onPick: (day: string) => void }) {
  const query = useCashCloseOverview(date, branchId);
  const scroller = useRef<HTMLDivElement>(null);
  const row = query.data?.strip.rows.find((item) => item.branchId === branchId) ?? query.data?.strip.rows[0];
  const ready = !!row;

  // มือถือ: แถบยาวกว่าจอ — เปิดมาต้องเห็นวันล่าสุด (ขวาสุด) ไม่ใช่ 14 วันก่อน
  useEffect(() => {
    if (ready && scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [ready]);

  if (query.isLoading) return <div className="h-[104px] animate-pulse rounded-xl border border-border bg-card" />;
  if (query.isError || !query.data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm leading-snug text-destructive">
        โหลดแถบ 14 วันไม่สำเร็จ: {getErrorMessage(query.error)}{' '}
        <button type="button" className="underline" onClick={() => query.refetch()}>ลองอีกครั้ง</button>
      </div>
    );
  }
  if (!row) return null;

  const { dates } = query.data.strip;
  const { today } = query.data;
  const counts = DAY_STATE_ORDER.map((state) => ({ state, count: row.cells.filter((cell) => cell === state).length })).filter((item) => item.count > 0);

  return (
    <section className="space-y-2.5 rounded-xl border border-border bg-card px-3 py-3 sm:px-4" aria-label={`ส่งยอดครบทุกวันไหม ${dates.length} วันล่าสุด`}>
      <div ref={scroller} className="-mx-1.5 overflow-x-auto px-1.5 py-1">
        <div className="grid min-w-[640px] grid-cols-[repeat(14,minmax(0,1fr))] gap-1.5 sm:min-w-0">
          {row.cells.map((state, index) => {
            const day = dates[index];
            const Icon = DAY_STATE_ICON[state];
            const selected = day === date;
            return (
              <button key={day} type="button" onClick={() => onPick(day)} aria-pressed={selected}
                aria-label={`${thaiDayMonth(day)} ${DAY_STATE_LABEL[state]}`} title={`${thaiDayMonth(day)} · ${DAY_STATE_LABEL[state]}`}
                className={`flex min-h-[64px] flex-col items-center justify-center gap-0.5 rounded-[10px] border text-[11px] leading-snug outline-offset-2 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${DAY_STATE_TILE[state]} ${selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}>
                <span className={day === today ? 'font-semibold' : ''}>{day === today ? 'วันนี้' : weekdayShort(day)}</span>
                <span className="text-sm font-semibold tabular-nums text-foreground">{Number(day.slice(8))}</span>
                <Icon aria-hidden className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>
      </div>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-snug">
        {counts.map(({ state, count }) => {
          const Icon = DAY_STATE_ICON[state];
          return (
            <li key={state} className={`inline-flex items-center gap-1.5 ${LEGEND_TONE[state]}`}>
              <Icon aria-hidden className="h-3.5 w-3.5" />{DAY_STATE_SHORT[state]} {count} วัน
            </li>
          );
        })}
        <li className="ml-auto text-muted-foreground">กดวันเพื่อเปิดดูวันนั้น</li>
      </ul>
    </section>
  );
}
