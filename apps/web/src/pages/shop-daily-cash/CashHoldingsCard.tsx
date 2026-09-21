import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Lock, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CashDepositDialog from './CashDepositDialog';
import { useCashCloseOverview } from './cash-close-overview.query';
import { thaiDayMonth, weekdayShort } from './cash-hero';
import { baht, dayOf, type CashHolding } from './cash-close';

/**
 * การ์ดข้างกล่องสถานะ (mockup CnXmYLkT กระดาน 15): สองเรื่องที่เจ้าของอยากรู้ที่สุดโดยไม่ต้องไล่หา —
 * (1) เงินสดที่รับจากพนักงานแล้วแต่ยังไม่ได้ฝากธนาคาร (ตู้เซฟสาขา = ยังไม่ถึงบริษัท · เจ้าของเก็บไว้ = ถึงบริษัทแล้ว รอฝาก)
 * (2) วันที่มีเงินสดแต่ไม่มีใครส่งยอด ใน 14 วันล่าสุด — กดเปิดดูวันนั้นได้
 * ข้อมูลชุดเดียวกับแถบ 14 วัน (key เดียวกัน ไม่ยิงซ้ำ) · สิทธิ์นำฝากมาจาก `canDeposit` ของ API
 */
const MAX_FOLLOW_UP = 5;

export default function CashHoldingsCard({ date, branchId, onPick }: { date: string; branchId: string; onPick: (day: string) => void }) {
  const [depositing, setDepositing] = useState<CashHolding | null>(null);
  const query = useCashCloseOverview(date, branchId);
  if (query.isLoading) return <div className="h-40 animate-pulse rounded-xl border border-border bg-card" />;
  // แถบ 14 วันที่ใช้ข้อมูลชุดเดียวกันเป็นคนบอกข้อผิดพลาด + ปุ่มลองใหม่ — ไม่ขึ้นซ้ำสองกล่อง
  if (query.isError || !query.data) return null;

  const holdings = query.data.holdings.filter((holding) => holding.branchId === branchId);
  const total = holdings.reduce((sum, holding) => sum + holding.outstanding, 0);
  const row = query.data.strip.rows.find((item) => item.branchId === branchId) ?? query.data.strip.rows[0];
  const missed = (row?.cells ?? []).map((state, index) => ({ state, day: query.data.strip.dates[index] }))
    .filter((item) => item.state === 'MISSED').reverse();

  return (
    <aside className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 leading-snug sm:p-5" aria-label="เงินสดที่ยังไม่ได้ฝากธนาคาร และวันที่ต้องตามดู">
      <div className="space-y-1">
        <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground">เงินสดที่ยังไม่ได้ฝากธนาคาร</h2>
        {holdings.length === 0 ? (
          <p className="flex items-start gap-2 text-sm text-foreground">
            <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />ไม่มีเงินค้าง — เงินสดที่รับแล้วฝากธนาคารครบ
          </p>
        ) : (
          <div className="text-[26px] font-bold tabular-nums">{baht(total)} ฿</div>
        )}
      </div>

      {holdings.length > 0 && (
        <ul className="divide-y divide-border/70 border-t border-border/70 text-[13px]">
          {holdings.map((holding) => {
            const Icon = holding.reachedCompany ? Wallet : Lock;
            return (
              <li key={holding.source} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2.5">
                <span className="flex items-start gap-1.5">
                  <Icon aria-hidden className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${holding.reachedCompany ? 'text-muted-foreground' : 'text-warning-strong'}`} />
                  <span className="flex flex-col">
                    <span className="font-semibold text-foreground">{holding.sourceLabel}</span>
                    <span className="text-xs text-muted-foreground">
                      {holding.reachedCompany ? 'ถึงบริษัทแล้ว รอฝากธนาคาร' : 'ยังไม่ถึงบริษัท'}
                      {holding.oldestConfirmedAt ? ` · ตั้งแต่ ${dayOf(holding.oldestConfirmedAt)}` : ''}
                    </span>
                  </span>
                </span>
                <span className="text-right font-semibold tabular-nums">{baht(holding.outstanding)}</span>
                <span className="col-span-2">
                  {holding.canDeposit
                    ? <Button variant="outline" size="md" className="min-h-11 w-full border-primary text-primary" onClick={() => setDepositing(holding)}>บันทึกนำฝาก{holdings.length > 1 ? ` — ${holding.sourceLabel}` : ''}</Button>
                    : <span className="text-xs text-muted-foreground">{holding.source === 'OWNER_HOLD' ? 'รอเจ้าของหรือผู้จัดการการเงินบันทึกนำฝาก' : 'รอเจ้าของ ผู้จัดการการเงิน หรือผู้จัดการสาขาบันทึกนำฝาก'}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-auto space-y-1.5 border-t border-border pt-3">
        <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground">วันที่ต้องตามดู ({query.data.strip.dates.length} วันล่าสุด)</h2>
        {missed.length === 0 ? (
          <p className="flex items-start gap-2 text-[13px] text-foreground">
            <CheckCircle2 aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />ส่งยอดครบทุกวันที่มีเงินสด
          </p>
        ) : (
          <ul className="space-y-0.5">
            {missed.slice(0, MAX_FOLLOW_UP).map(({ day }) => (
              <li key={day} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-[13px]">
                <span className="flex items-start gap-1.5 font-semibold text-destructive">
                  <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />{weekdayShort(day)} {thaiDayMonth(day)} — มีเงินสดแต่ไม่ส่งยอด
                </span>
                <button type="button" onClick={() => onPick(day)} aria-label={`เปิดดูวันที่ ${thaiDayMonth(day)}`}
                  className="inline-flex min-h-11 items-center px-1 text-[13px] text-primary underline-offset-2 hover:underline">เปิดดู</button>
              </li>
            ))}
            {missed.length > MAX_FOLLOW_UP && <li className="text-xs text-muted-foreground">และอีก {missed.length - MAX_FOLLOW_UP} วัน — ดูได้จากแถบ 14 วัน</li>}
          </ul>
        )}
      </div>

      {depositing && <CashDepositDialog holding={depositing} onClose={() => setDepositing(null)} />}
    </aside>
  );
}
