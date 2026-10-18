import { AlertTriangle, ArrowDownToLine, Plus, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PettyCashSummary } from '../types';
import { money } from '../petty-cash.util';

export interface BalanceHeroProps {
  summary: PettyCashSummary;
  canOperate: boolean;
  canSetLimit: boolean;
  onTopUp: () => void;
  onReturn: () => void;
  onSetLimit: () => void;
}

const asOf = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** กล่องยอดคงเหลือ (mockup กระดาน 1): ยอด · วงเงิน · เติมได้อีก/เกินวงเงิน · แถบ · ปุ่มเติม/คืน/ตั้งวงเงิน */
export function BalanceHero({ summary, canOperate, canSetLimit, onTopUp, onReturn, onSetLimit }: BalanceHeroProps) {
  const balance = Number(summary.balance);
  const limit = Number(summary.limit.value);
  const headroom = Number(summary.headroom);
  const overLimit = Number(summary.overLimit);
  const pct = limit > 0 ? Math.min(100, Math.max(0, (balance / limit) * 100)) : balance > 0 ? 100 : 0;
  return (
    <section aria-label="ยอดคงเหลือเงินสดย่อย" className="flex min-w-0 flex-[2_1_560px] flex-col gap-4 rounded-xl border border-border/50 bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-muted-foreground">ยอดคงเหลือเงินสดย่อย</div>
          <div className="flex items-baseline gap-2">
            <span data-testid="petty-cash-balance" className="font-mono text-4xl font-semibold tabular-nums tracking-tight">{money(balance)}</span>
            <span className="text-muted-foreground">บาท</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <div className="text-sm text-muted-foreground">
            วงเงิน <span className="font-mono font-medium text-foreground">{money(limit)}</span> บาท
            {summary.limit.source === 'DEFAULT' && <span className="ml-1 text-xs">· ค่าเริ่มต้น (ยังไม่เคยตั้ง)</span>}
          </div>
          {overLimit > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
              <AlertTriangle className="size-3.5" aria-hidden />
              เกินวงเงิน {money(overLimit)} บาท — คืนเงินเข้าธนาคารหรือตั้งวงเงินใหม่
            </span>
          ) : (
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', headroom > 0 ? 'bg-warning/10 text-warning-strong' : 'bg-muted text-muted-foreground')}>
              <Plus className="size-3.5" aria-hidden />
              {headroom > 0 ? `เติมได้อีก ${money(headroom)} บาท` : 'ยอดถึงวงเงินแล้ว'}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <div role="img" aria-label={`คงเหลือ ${pct.toFixed(1)}% ของวงเงิน`} className="h-2.5 overflow-hidden rounded-full bg-muted">
          <div className={cn('h-full rounded-full', overLimit > 0 ? 'bg-destructive' : 'bg-primary')} style={{ width: `${pct}%` }} />
        </div>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>คงเหลือ {pct.toFixed(1)}% ของวงเงิน</span>
          <span>อ่านจากสมุดบัญชี SHOP {summary.accountCode} · {asOf(summary.asOf)}</span>
        </div>
      </div>

      {(canOperate || canSetLimit) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {canOperate && (
            <>
              <Button type="button" variant="primary" onClick={onTopUp} disabled={headroom <= 0} title={headroom <= 0 ? 'ยอดถึงวงเงินแล้ว' : undefined}>
                <Plus className="size-4" aria-hidden />
                เติมเงินสดย่อย
              </Button>
              <Button type="button" variant="outline" onClick={onReturn} disabled={balance <= 0}>
                <ArrowDownToLine className="size-4" aria-hidden />
                คืนเงินเข้าธนาคาร
              </Button>
            </>
          )}
          <div className="flex-1" />
          {canSetLimit && (
            <Button type="button" variant="ghost" onClick={onSetLimit} className="text-muted-foreground">
              <Settings2 className="size-4" aria-hidden />
              ตั้งวงเงิน
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
