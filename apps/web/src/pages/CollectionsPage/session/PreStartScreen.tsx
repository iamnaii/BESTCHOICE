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
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (count === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
        <div className="text-base font-semibold leading-snug mb-1">วันนี้ไม่มีคิวงานของคุณ</div>
        <div className="text-sm text-muted-foreground leading-snug">
          ดู pool กลางถ้าอยากหยิบงานเพิ่ม
        </div>
      </div>
    );
  }

  const hours = Math.floor(eta / 60);
  const minutes = eta % 60;

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm p-6 sm:p-8">
      <div className="text-sm text-muted-foreground leading-snug mb-1">
        สวัสดี {user?.name ?? ''}
      </div>
      <div className="text-2xl sm:text-3xl font-bold leading-snug mb-1">
        วันนี้คุณมีคิว <span className="text-primary tabular-nums">{count}</span> ราย
      </div>
      <div className="text-sm text-muted-foreground leading-snug mb-6">
        ประมาณ {hours > 0 ? `${hours} ชม. ` : ''}
        {minutes > 0 ? `${minutes} นาที` : hours > 0 ? '' : 'ไม่กี่นาที'}
      </div>

      <Button
        size="lg"
        className="w-full sm:w-auto sm:min-w-[280px] h-14 text-base"
        onClick={onStart}
        disabled={starting}
      >
        {starting ? (
          <Loader2 className="size-5 animate-spin mr-2" />
        ) : (
          <Play className="size-5 mr-2" fill="currentColor" />
        )}
        เริ่มงานเก็บเงิน
      </Button>

      {breakdown && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-8 pt-6 border-t border-border/40">
          <Stat icon={Phone} label="ต้องโทร" value={breakdown.calls} color="text-primary" />
          <Stat icon={MessageCircle} label="ส่ง LINE" value={breakdown.lines} color="text-info" />
          <Stat label="ค้างนาน" value={breakdown.severe} color="text-destructive" />
          <Stat label="ค้างปานกลาง" value={breakdown.medium} color="text-warning" />
        </div>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  color = 'text-foreground',
}: {
  icon?: any;
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {Icon && <Icon className={`size-4 ${color}`} />}
      <div>
        <div className="text-2xs uppercase tracking-wider text-muted-foreground/80 leading-snug">
          {label}
        </div>
        <div className={`font-mono text-base font-bold tabular-nums tracking-tight leading-snug ${color}`}>
          {value}
        </div>
      </div>
    </div>
  );
}
