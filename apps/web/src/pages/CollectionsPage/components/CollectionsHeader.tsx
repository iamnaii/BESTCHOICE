import {
  Phone,
  MessageCircle,
  Handshake,
  CircleDollarSign,
  TrendingUp,
  TrendingDown,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { formatNumber } from '@/utils/formatters';
import { useCollectionsKpi } from '../hooks/useCollectionsKpi';
import { useMyTodayKpi } from '../hooks/useMyTodayKpi';
import { useQueueFilter } from '../hooks/useQueueFilter';

interface Props {
  onSwitchToToday: () => void;
}

/**
 * Circular progress dial — signature element for the call-target chip.
 * Replaces a thin bar with a more legible at-a-glance visual.
 */
function ProgressDial({
  icon: Icon,
  progress,
  ringClass,
  iconClass,
}: {
  icon: LucideIcon;
  progress: number;
  ringClass: string;
  iconClass: string;
}) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const filled = Math.min(1, Math.max(0, progress)) * c;
  return (
    <div className="relative size-8 shrink-0">
      <svg viewBox="0 0 32 32" className="size-8 -rotate-90">
        <circle cx="16" cy="16" r={r} fill="none" strokeWidth="2.5" className="stroke-muted" />
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          className={`${ringClass} transition-[stroke-dasharray] duration-1000 ease-out`}
          strokeDasharray={`${filled} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <Icon className={`size-3.5 ${iconClass}`} aria-hidden />
      </div>
    </div>
  );
}

interface MetricProps {
  icon?: LucideIcon;
  iconClass?: string;
  label: string;
  value: string;
  trailing?: React.ReactNode;
  sublabel?: string;
  loading?: boolean;
  loadingWidth?: string;
  onClick?: () => void;
  /** When provided, replaces the icon with a circular progress dial. */
  dialProgress?: number;
  dialRingClass?: string;
  valueClass?: string;
  /** 0-based index for staggered fade-in on mount. */
  index?: number;
}

function Metric({
  icon: Icon,
  iconClass = 'text-muted-foreground',
  label,
  value,
  trailing,
  sublabel,
  loading,
  loadingWidth = 'w-16',
  onClick,
  dialProgress,
  dialRingClass = 'stroke-primary',
  valueClass = 'text-foreground',
  index = 0,
}: MetricProps) {
  const Tag = onClick ? 'button' : ('div' as const);
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      style={{ animationDelay: `${index * 40}ms` }}
      className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all duration-200 min-w-0 animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards ${
        onClick
          ? 'hover:bg-accent/60 cursor-pointer hover:-translate-y-px active:translate-y-0'
          : ''
      }`}
    >
      {dialProgress !== undefined && Icon ? (
        <ProgressDial
          icon={Icon}
          progress={dialProgress}
          ringClass={dialRingClass}
          iconClass={iconClass}
        />
      ) : (
        Icon && (
          <Icon
            className={`size-3.5 shrink-0 mt-0.5 ${iconClass}`}
            aria-hidden
          />
        )
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80 leading-snug mb-1">
          {label}
        </div>
        {loading ? (
          <div className={`h-5 ${loadingWidth} rounded bg-muted animate-pulse`} />
        ) : (
          <div className="flex items-baseline gap-1.5 leading-none flex-wrap">
            <span
              className={`font-mono text-base font-semibold tabular-nums tracking-tight ${valueClass}`}
            >
              {value}
            </span>
            {trailing}
          </div>
        )}
        {sublabel && !loading && (
          <div className="text-[10px] text-muted-foreground/70 mt-1 leading-snug truncate tracking-wide">
            {sublabel}
          </div>
        )}
      </div>
    </Tag>
  );
}

function SectionLabel({
  children,
  accentClass = 'bg-primary',
}: {
  children: React.ReactNode;
  accentClass?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-2.5 mb-1.5">
      <span className={`block h-3 w-[3px] rounded-full ${accentClass}`} aria-hidden />
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground leading-snug">
        {children}
      </span>
    </div>
  );
}

/** Hairline divider with a small knot in the middle — replaces a flat border. */
function HairlineDivider() {
  return (
    <div className="relative h-px bg-border/60" aria-hidden>
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 block size-1 rounded-full bg-border" />
    </div>
  );
}

export default function CollectionsHeader({ onSwitchToToday }: Props) {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';

  const todayKpi = useMyTodayKpi();
  const sysKpi = useCollectionsKpi('7d');

  const [, setFilter] = useQueueFilter('queue');

  const goToday = (patch: Parameters<typeof setFilter>[0]) => {
    onSwitchToToday();
    setFilter(patch);
  };

  if (sysKpi.isError) {
    return (
      <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 flex items-center justify-between">
        <span className="text-sm text-destructive leading-snug">ไม่สามารถโหลด KPI ได้</span>
        <button
          onClick={() => sysKpi.refetch()}
          className="px-2.5 py-1 text-xs border border-destructive/30 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
        >
          ลองใหม่
        </button>
      </div>
    );
  }

  const today = todayKpi.data;
  const callProgress =
    today && today.callsTarget > 0 ? today.callsToday / today.callsTarget : 0;
  const collected = today ? formatBahtCompact(today.collectedTodayBaht) : '-';

  const sys = sysKpi.data;
  const trend = sys?.queueTodayTrend ?? 0;
  const promiseRate = sys ? Math.round(sys.promiseKeptRate7d * 100) : null;

  return (
    <div className="mb-4 rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
      {/* Section: ของฉันวันนี้ — personal */}
      {!todayKpi.isError && (
        <div className="px-2 pt-3 pb-2">
          <SectionLabel accentClass="bg-primary">ของฉันวันนี้</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-0.5">
            <Metric
              index={0}
              icon={Phone}
              iconClass="text-primary"
              dialProgress={callProgress}
              dialRingClass="stroke-primary"
              label="โทรวันนี้"
              value={today?.callsToday?.toString() ?? '-'}
              trailing={
                today && (
                  <span className="font-mono text-xs text-muted-foreground/70 tabular-nums tracking-tight">
                    / {today.callsTarget}
                  </span>
                )
              }
              loading={todayKpi.isLoading}
              onClick={() => goToday({ lastContacted: 'today' })}
            />
            <Metric
              index={1}
              icon={MessageCircle}
              iconClass="text-info"
              label="LINE ส่งวันนี้"
              value={today?.lineSentToday?.toString() ?? '-'}
              loading={todayKpi.isLoading}
              onClick={() => goToday({ lineResponse: 'responded' })}
            />
            <Metric
              index={2}
              icon={Handshake}
              iconClass="text-warning"
              label="นัดสำเร็จ"
              value={today?.promisesKeptToday?.toString() ?? '-'}
              loading={todayKpi.isLoading}
              onClick={() => goToday({ hasActivePromise: true })}
            />
            <Metric
              index={3}
              icon={CircleDollarSign}
              iconClass="text-success"
              label="เก็บได้วันนี้"
              value={collected}
              trailing={
                <span className="font-mono text-xs text-muted-foreground/70 font-normal">฿</span>
              }
              loading={todayKpi.isLoading}
              onClick={() => onSwitchToToday()}
            />
          </div>
        </div>
      )}

      <HairlineDivider />

      {/* Section: ภาพรวม 7 วัน — system */}
      <div className="px-2 pt-3 pb-2">
        <SectionLabel accentClass="bg-destructive">ภาพรวม 7 วัน</SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-0.5">
          <Metric
            index={4}
            label="ค้างรวม"
            value={sys ? formatNumber(sys.totalOutstanding) : '-'}
            trailing={<span className="font-mono text-xs text-muted-foreground/70">฿</span>}
            valueClass="text-destructive"
            sublabel={sys ? `+ ค่าปรับ ${formatNumber(sys.totalLateFees)} ฿` : undefined}
            loading={sysKpi.isLoading}
            loadingWidth="w-24"
          />
          <Metric
            index={5}
            label="คิววันนี้"
            value={sys?.queueToday?.toString() ?? '-'}
            valueClass="text-primary"
            sublabel="วันนี้"
            trailing={
              trend !== 0 && (
                <span
                  className={`inline-flex items-center gap-0.5 font-mono text-xs font-medium tabular-nums tracking-tight ${
                    trend > 0 ? 'text-destructive' : 'text-success'
                  }`}
                >
                  {trend > 0 ? (
                    <TrendingUp className="size-3" />
                  ) : (
                    <TrendingDown className="size-3" />
                  )}
                  {Math.abs(trend).toFixed(0)}%
                </span>
              )
            }
            loading={sysKpi.isLoading}
          />
          <Metric
            index={6}
            label="นัดชำระ"
            value={sys?.promisedCount?.toString() ?? '-'}
            valueClass="text-warning"
            sublabel="รอชำระ"
            loading={sysKpi.isLoading}
          />
          <Metric
            index={7}
            label="Promise-kept"
            value={promiseRate !== null ? `${promiseRate}%` : '-'}
            valueClass="text-success"
            sublabel="7 วันล่าสุด"
            loading={sysKpi.isLoading}
          />
        </div>
      </div>

      {/* Collector workload — OWNER only */}
      {isOwner && sys?.collectorWorkload && sys.collectorWorkload.length > 0 && (
        <>
          <HairlineDivider />
          <div className="px-4 py-2.5 bg-muted/20">
            <div className="flex items-center gap-2 mb-2">
              <Users className="size-3.5 text-primary" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground leading-snug">
                ผู้ติดตามหนี้
              </span>
              <span className="text-[10px] text-muted-foreground/60 leading-snug">
                ยังไม่ปิด
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sys.collectorWorkload.map((w, i) => (
                <div
                  key={w.userId}
                  style={{ animationDelay: `${300 + i * 30}ms` }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-card px-2.5 py-1 text-xs animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards"
                >
                  <span className="font-medium leading-snug">{w.name}</span>
                  <span className="font-mono tabular-nums text-muted-foreground tracking-tight">
                    {w.count}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 leading-snug">ราย</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function formatBahtCompact(decimalString: string): string {
  const n = Number(decimalString);
  if (!Number.isFinite(n)) return '-';
  return Math.round(n).toLocaleString();
}
