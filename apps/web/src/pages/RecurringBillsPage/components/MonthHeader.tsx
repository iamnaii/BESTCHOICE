import { CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { currentMonthKey, monthTitle, shiftMonth } from './labels';

interface MonthHeaderProps {
  month: string;
  onMonthChange: (month: string) => void;
  branchId: string;
  onBranchChange: (branchId: string) => void;
  branches: Array<{ id: string; name: string }>;
  /** ผจก.สาขาถูกล็อกสาขาตนเองที่ API — ไม่ต้องมีตัวเลือก */
  showBranch: boolean;
  onCreate: () => void;
}

export function MonthHeader({ month, onMonthChange, branchId, onBranchChange, branches, showBranch, onCreate }: MonthHeaderProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <CalendarClock className="size-5 text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h1 className="break-words text-base font-semibold leading-snug text-foreground">บิลประจำ — {monthTitle(month)}</h1>
          <p className="text-sm leading-snug text-muted-foreground">ระบบสร้างร่างใบรายจ่ายให้ล่วงหน้าและเตือนก่อนครบกำหนด — ไม่โพสต์/ไม่จ่ายให้เอง</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-lg border border-border">
          <Button variant="ghost" size="icon" aria-label="เดือนก่อนหน้า" onClick={() => onMonthChange(shiftMonth(month, -1))}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onMonthChange(currentMonthKey())}>เดือนนี้</Button>
          <Button variant="ghost" size="icon" aria-label="เดือนถัดไป" onClick={() => onMonthChange(shiftMonth(month, 1))}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        {showBranch && (
          <select
            aria-label="สาขา"
            value={branchId}
            onChange={(e) => onBranchChange(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          >
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
        <Button variant="primary" size="sm" onClick={onCreate}>+ บิลประจำ</Button>
      </div>
    </div>
  );
}
