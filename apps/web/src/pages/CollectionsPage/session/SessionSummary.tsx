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
  const onTime = delta >= 0;
  const fasterText =
    delta > 0
      ? `เร็วกว่าเป้า ${delta} นาที`
      : delta < 0
        ? `ช้ากว่าเป้า ${Math.abs(delta)} นาที`
        : 'ตรงตามเป้า';

  const elapsedHours = Math.floor(summary.elapsedMinutes / 60);
  const elapsedMins = summary.elapsedMinutes % 60;
  const elapsedDisplay =
    elapsedHours > 0
      ? `${elapsedHours} ชั่วโมง ${elapsedMins} นาที`
      : `${elapsedMins} นาที`;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Hero — celebration */}
      <div className="rounded-2xl border border-border/50 bg-card shadow-sm p-8 sm:p-12 text-center">
        <div className="flex items-center justify-center mb-5">
          <div className="size-20 rounded-full bg-success/10 flex items-center justify-center">
            <CheckCircle2 className="size-12 text-success" />
          </div>
        </div>

        <div className="text-3xl sm:text-4xl font-bold leading-snug mb-2">
          ทำครบทั้ง {summary.total} ราย
        </div>
        <div className="text-base sm:text-lg text-muted-foreground leading-relaxed">
          ผลงานวันนี้ของคุณ
        </div>
      </div>

      {/* Stats — clear rows, not cramped grid */}
      <div className="rounded-2xl border border-border/50 bg-card shadow-sm p-6 sm:p-8">
        <div className="text-sm font-semibold text-foreground leading-snug mb-4">
          สรุปผลงาน
        </div>
        <div className="space-y-3">
          <Row
            icon={CheckCircle2}
            label="โทรติด คุยกับลูกค้าได้"
            value={summary.callsConnected}
            unit="ราย"
            tone="text-success"
          />
          <Row
            icon={PhoneOff}
            label="โทรไม่ติด ไม่รับสาย"
            value={summary.callsNoAnswer}
            unit="ราย"
            tone="text-muted-foreground"
          />
          <Row
            icon={MessageCircle}
            label="ส่งข้อความผ่าน LINE"
            value={summary.lineSent}
            unit="ราย"
            tone="text-info"
          />
          {summary.skipped > 0 && (
            <Row
              icon={SkipForward}
              label="ข้ามไปก่อน"
              value={summary.skipped}
              unit="ราย"
              tone="text-warning"
            />
          )}
        </div>

        <div className="mt-5 pt-5 border-t border-border/40">
          <Row
            icon={Clock}
            label="เวลาที่ใช้ทั้งหมด"
            value={elapsedDisplay}
            unit=""
            tone="text-foreground"
            extra={
              <div
                className={`text-sm font-medium leading-snug ${onTime ? 'text-success' : 'text-warning'}`}
              >
                {fasterText}
              </div>
            }
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
        <Button variant="outline" size="lg" className="h-14 text-base" onClick={onShowPool}>
          ดูงานใน pool กลาง
        </Button>
        <Button size="lg" className="h-14 text-base font-semibold" onClick={onBackToHome}>
          กลับหน้าหลัก
        </Button>
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  unit,
  tone = 'text-foreground',
  extra,
}: {
  icon: any;
  label: string;
  value: number | string;
  unit: string;
  tone?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4">
      <div className={`size-11 rounded-full bg-muted/50 flex items-center justify-center shrink-0 ${tone}`}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-muted-foreground leading-snug">{label}</div>
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-1.5">
            <span className={`text-2xl font-bold tabular-nums leading-none ${tone}`}>{value}</span>
            {unit && <span className="text-base text-muted-foreground leading-snug">{unit}</span>}
          </div>
          {extra}
        </div>
      </div>
    </div>
  );
}
