import { Phone, MessageCircle, Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import type { MySession } from '../hooks/useMySession';

interface Props {
  data: MySession | undefined;
  isLoading: boolean;
  onStart: () => void;
  starting?: boolean;
}

export default function PreStartScreen({ data, isLoading, onStart, starting }: Props) {
  const { user } = useAuth();
  const count = data?.target.count ?? 0;
  const eta = data?.target.etaMinutes ?? 0;
  const breakdown = data?.breakdown;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (count === 0) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card p-10 sm:p-14 text-center max-w-2xl mx-auto">
        <div className="text-2xl sm:text-3xl font-bold leading-snug mb-3">
          วันนี้ไม่มีคิวงานของคุณ
        </div>
        <div className="text-base text-muted-foreground leading-relaxed">
          ดู pool กลางถ้าอยากหยิบงานเพิ่ม
        </div>
      </div>
    );
  }

  const hours = Math.floor(eta / 60);
  const minutes = eta % 60;
  const etaText =
    hours > 0 && minutes > 0
      ? `${hours} ชั่วโมง ${minutes} นาที`
      : hours > 0
        ? `${hours} ชั่วโมง`
        : `${minutes} นาที`;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="rounded-2xl border border-border/50 bg-card shadow-sm p-8 sm:p-12 text-center">
        {/* Greeting */}
        <div className="text-base sm:text-lg text-muted-foreground leading-relaxed mb-3">
          สวัสดีคุณ {user?.name ?? ''}
        </div>

        {/* Hero — the big number */}
        <div className="mb-2">
          <div className="text-base sm:text-lg text-foreground leading-relaxed mb-1">
            วันนี้คุณมีคิวงาน
          </div>
          <div className="flex items-baseline justify-center gap-2 sm:gap-3">
            <span className="text-7xl sm:text-8xl font-bold tabular-nums text-primary leading-none tracking-tight">
              {count}
            </span>
            <span className="text-2xl sm:text-3xl font-semibold text-foreground leading-snug">
              ราย
            </span>
          </div>
        </div>

        {/* ETA */}
        <div className="text-base sm:text-lg text-muted-foreground leading-relaxed mt-2 mb-8 sm:mb-10">
          ใช้เวลาประมาณ <span className="font-semibold text-foreground">{etaText}</span>
        </div>

        {/* Single big CTA */}
        <Button
          size="lg"
          className="w-full sm:w-auto sm:min-w-[320px] h-16 text-lg font-semibold"
          onClick={onStart}
          disabled={starting}
        >
          {starting ? (
            <Loader2 className="size-6 animate-spin mr-2.5" />
          ) : (
            <Play className="size-6 mr-2.5" fill="currentColor" />
          )}
          เริ่มทำงาน
        </Button>
      </div>

      {/* Breakdown — separate card below for less density */}
      {breakdown && (
        <div className="mt-4 rounded-2xl border border-border/50 bg-card shadow-sm p-6 sm:p-8">
          <div className="text-sm font-semibold text-foreground leading-snug mb-4">
            รายละเอียดงานวันนี้
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
            <Row icon={Phone} label="ต้องโทร" value={breakdown.calls} unit="ราย" tone="text-primary" />
            <Row
              icon={MessageCircle}
              label="ส่ง LINE"
              value={breakdown.lines}
              unit="ราย"
              tone="text-info"
            />
            <Row label="ค้างนาน 30 วันขึ้นไป" value={breakdown.severe} unit="ราย" tone="text-destructive" />
            <Row
              label="ค้าง 8-29 วัน"
              value={breakdown.medium}
              unit="ราย"
              tone="text-warning"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  unit,
  tone = 'text-foreground',
}: {
  icon?: any;
  label: string;
  value: number;
  unit: string;
  tone?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {Icon ? (
        <div className={`size-9 rounded-full bg-muted/50 flex items-center justify-center ${tone}`}>
          <Icon className="size-4" />
        </div>
      ) : (
        <div className={`size-9 rounded-full ${tone.replace('text-', 'bg-')}/15 flex items-center justify-center`}>
          <span className={`block size-2 rounded-full ${tone.replace('text-', 'bg-')}`} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm text-muted-foreground leading-snug truncate">{label}</div>
        <div className="flex items-baseline gap-1.5 mt-0.5">
          <span className={`text-2xl font-bold tabular-nums leading-none ${tone}`}>{value}</span>
          <span className="text-sm text-muted-foreground leading-snug">{unit}</span>
        </div>
      </div>
    </div>
  );
}
