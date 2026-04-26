import {
  Phone,
  Coins,
  Handshake,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Users,
  Loader2,
} from 'lucide-react';
import { formatNumber } from '@/utils/formatters';
import { useTeamDashboard, type CollectorStatus } from '../hooks/useTeamDashboard';

export default function TeamOverviewTab() {
  const { data, isLoading } = useTeamDashboard();

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { today, collectors, alerts } = data;
  const callsRatio =
    today.assignmentsTotal > 0
      ? Math.round((today.callsMade / today.assignmentsTotal) * 100)
      : 0;

  return (
    <div className="space-y-4">
      {/* Section 1: Today pulse */}
      <div className="rounded-2xl border border-border/50 bg-card shadow-sm p-5">
        <div className="text-sm font-semibold text-foreground leading-snug mb-4">
          วันนี้ทีมทำได้
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Stat
            icon={Coins}
            label="เก็บเงินได้"
            value={formatNumber(today.totalCollected)}
            unit="฿"
            tone="text-success"
            bg="bg-success/10"
          />
          <Stat
            icon={Phone}
            label="โทรไปแล้ว"
            value={`${today.callsMade}`}
            unit={today.assignmentsTotal > 0 ? `/ ${today.assignmentsTotal} ราย` : 'ราย'}
            tone="text-primary"
            bg="bg-primary/10"
          />
          <Stat
            icon={Handshake}
            label="นัดสำเร็จ"
            value={`${today.promisesMade}`}
            unit="ราย"
            tone="text-warning"
            bg="bg-warning/10"
          />
        </div>
        {today.assignmentsTotal > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground leading-snug mb-1.5">
              <span>ความคืบหน้าวันนี้</span>
              <span className="font-mono font-semibold tabular-nums">
                {today.callsMade}/{today.assignmentsTotal} ({callsRatio}%)
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${callsRatio}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Section 2: Alerts (only when there are any) */}
      {alerts.length > 0 && (
        <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-warning leading-snug mb-2.5">
            <AlertTriangle className="size-4" />
            ต้องดำเนินการ
          </div>
          <ul className="space-y-1.5">
            {alerts.map((a, i) => (
              <li key={i} className="text-sm text-foreground leading-snug flex items-start gap-2">
                <span className="text-warning leading-snug">•</span>
                <span>{a.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Section 3: Per-collector cards */}
      <div className="rounded-2xl border border-border/50 bg-card shadow-sm p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground leading-snug mb-4">
          <Users className="size-4" />
          ทีมตอนนี้
        </div>
        {collectors.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center leading-snug">
            ไม่มีพนักงาน SALES ในระบบ
          </div>
        ) : (
          <div className="space-y-3">
            {collectors.map((c) => (
              <CollectorRow key={c.id} collector={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  unit,
  tone,
  bg,
}: {
  icon: any;
  label: string;
  value: string;
  unit?: string;
  tone: string;
  bg: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={`size-11 rounded-full ${bg} flex items-center justify-center shrink-0 ${tone}`}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-muted-foreground leading-snug">{label}</div>
        <div className="flex items-baseline gap-1.5 mt-0.5">
          <span className={`text-2xl font-bold tabular-nums leading-none ${tone}`}>{value}</span>
          {unit && (
            <span className="text-sm text-muted-foreground leading-snug">{unit}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function CollectorRow({ collector }: { collector: CollectorStatus }) {
  const ratio =
    collector.assignmentsToday > 0
      ? Math.round((collector.callsToday / collector.assignmentsToday) * 100)
      : 0;

  const statusMeta: Record<
    CollectorStatus['status'],
    { color: string; bg: string; label: string }
  > = {
    'on-track': { color: 'text-success', bg: 'bg-success/10', label: 'ทำงานอยู่' },
    behind: { color: 'text-warning', bg: 'bg-warning/10', label: 'ช้ากว่าเป้า' },
    idle: { color: 'text-destructive', bg: 'bg-destructive/10', label: 'เงียบนาน' },
    inactive: { color: 'text-muted-foreground', bg: 'bg-muted', label: 'ไม่ active' },
  };
  const meta = statusMeta[collector.status];

  const lastCallText = collector.lastCallAt
    ? `โทรล่าสุด ${new Date(collector.lastCallAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`
    : 'ยังไม่ได้โทร';

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl border border-border/40 bg-muted/20">
      <div className={`size-10 rounded-full ${meta.bg} flex items-center justify-center shrink-0 ${meta.color}`}>
        {collector.status === 'on-track' ? (
          <CheckCircle2 className="size-5" />
        ) : collector.status === 'inactive' ? (
          <Users className="size-5" />
        ) : (
          <Clock className="size-5" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold leading-snug truncate">{collector.name}</span>
          <span className={`text-xs font-medium leading-snug ${meta.color}`}>· {meta.label}</span>
        </div>
        <div className="text-xs text-muted-foreground leading-snug truncate">
          {lastCallText}
          {collector.collectedToday > 0 && (
            <>
              {' · '}เก็บได้{' '}
              <span className="font-semibold text-success tabular-nums">
                {formatNumber(collector.collectedToday)} ฿
              </span>
            </>
          )}
        </div>
      </div>

      <div className="text-right shrink-0">
        <div className="text-base font-bold tabular-nums leading-snug">
          {collector.callsToday}
          <span className="text-sm text-muted-foreground font-normal">
            /{collector.assignmentsToday}
          </span>
        </div>
        <div className="text-xs text-muted-foreground leading-snug">
          ({ratio}%)
        </div>
      </div>
    </div>
  );
}
