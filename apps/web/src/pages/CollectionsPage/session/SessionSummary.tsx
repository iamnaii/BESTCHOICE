import { CheckCircle2, PhoneOff, MessageCircle, SkipForward, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MySession } from '../hooks/useMySession';

interface Props {
  summary: NonNullable<MySession['summary']>;
  targetMinutes: number;
  onShowPool: () => void;
  onBackToHome: () => void;
}

export default function SessionSummary({
  summary,
  targetMinutes,
  onShowPool,
  onBackToHome,
}: Props) {
  const delta = targetMinutes - summary.elapsedMinutes;
  const fasterText =
    delta > 0
      ? `เร็วกว่าเป้า ${delta} นาที`
      : delta < 0
        ? `ช้ากว่าเป้า ${Math.abs(delta)} นาที`
        : 'ตรงเป้า';

  const elapsedHours = Math.floor(summary.elapsedMinutes / 60);
  const elapsedMins = summary.elapsedMinutes % 60;
  const elapsedDisplay = `${elapsedHours}:${String(elapsedMins).padStart(2, '0')}`;

  return (
    <div className="rounded-2xl border border-border/50 bg-card shadow-sm p-6 sm:p-8 text-center max-w-3xl mx-auto">
      <div className="flex items-center justify-center mb-3">
        <div className="size-14 rounded-full bg-success/10 flex items-center justify-center">
          <CheckCircle2 className="size-8 text-success" />
        </div>
      </div>

      <div className="text-xl sm:text-2xl font-bold leading-snug mb-1">
        ทำครบทั้ง {summary.total} ราย
      </div>
      <div className="text-sm text-muted-foreground leading-snug mb-6">ผลงานวันนี้</div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat icon={CheckCircle2} label="โทรติด" value={summary.callsConnected} color="text-success" />
        <Stat icon={PhoneOff} label="โทรไม่ติด" value={summary.callsNoAnswer} color="text-muted-foreground" />
        <Stat icon={MessageCircle} label="ส่ง LINE" value={summary.lineSent} color="text-info" />
        <Stat icon={SkipForward} label="ข้าม" value={summary.skipped} color="text-warning" />
        <Stat icon={Clock} label="ใช้เวลา" value={elapsedDisplay} color="text-foreground" />
        <div className="rounded-xl border border-border/40 bg-muted/30 px-4 py-3 flex items-center justify-center text-2xs text-muted-foreground leading-snug">
          {fasterText}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 justify-center mt-8">
        <Button variant="outline" onClick={onShowPool}>
          ดู pool กลาง
        </Button>
        <Button onClick={onBackToHome}>กลับหน้าหลัก</Button>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  color = 'text-foreground',
}: {
  icon: any;
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-card px-4 py-3 flex items-center gap-3">
      <Icon className={`size-5 shrink-0 ${color}`} />
      <div className="text-left min-w-0">
        <div className="text-2xs uppercase tracking-wider text-muted-foreground/80 leading-snug">
          {label}
        </div>
        <div className="font-mono text-base font-bold tabular-nums tracking-tight leading-snug">
          {value}
        </div>
      </div>
    </div>
  );
}
