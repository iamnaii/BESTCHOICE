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

interface MetricProps {
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
  unit?: string;
  sublabel?: React.ReactNode;
  loading?: boolean;
  loadingWidth?: string;
  onClick?: () => void;
  valueClass?: string;
  /** Optional progress bar 0–1 below the value (used by call-target). */
  progress?: number;
  progressBarClass?: string;
}

function Metric({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  value,
  unit,
  sublabel,
  loading,
  loadingWidth = 'w-20',
  onClick,
  valueClass = 'text-foreground',
  progress,
  progressBarClass = 'bg-primary',
}: MetricProps) {
  const Tag = onClick ? 'button' : ('div' as const);
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors min-w-0 ${
        onClick ? 'hover:bg-accent/50 cursor-pointer' : ''
      }`}
    >
      <div
        className={`size-11 rounded-full ${iconBg} flex items-center justify-center shrink-0 ${iconColor}`}
      >
        <Icon className="size-5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-sm text-muted-foreground leading-snug truncate">{label}</div>

        {loading ? (
          <div className={`h-7 ${loadingWidth} rounded bg-muted animate-pulse mt-1`} />
        ) : (
          <>
            <div className="flex items-baseline gap-1.5 leading-none mt-1 flex-wrap">
              <span className={`text-2xl font-bold tabular-nums leading-none ${valueClass}`}>
                {value}
              </span>
              {unit && (
                <span className="text-base font-semibold text-muted-foreground leading-snug">
                  {unit}
                </span>
              )}
            </div>

            {progress !== undefined && (
              <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${progressBarClass} transition-all duration-700`}
                  style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
                />
              </div>
            )}

            {sublabel && (
              <div className="text-sm text-muted-foreground leading-snug truncate mt-1.5">
                {sublabel}
              </div>
            )}
          </>
        )}
      </div>
    </Tag>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-1">
      <span className="text-sm font-semibold text-foreground leading-snug">{children}</span>
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
      <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 flex items-center justify-between">
        <span className="text-sm text-destructive leading-snug">ไม่สามารถโหลดข้อมูล KPI ได้</span>
        <button
          onClick={() => sysKpi.refetch()}
          className="px-3 py-1.5 text-sm border border-destructive/30 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
        >
          ลองใหม่
        </button>
      </div>
    );
  }

  const today = todayKpi.data;
  const callProgress =
    today && today.callsTarget > 0 ? today.callsToday / today.callsTarget : undefined;
  const collected = today ? formatBahtCompact(today.collectedTodayBaht) : '-';

  const sys = sysKpi.data;
  const trend = sys?.queueTodayTrend ?? 0;
  const promiseRate = sys ? Math.round(sys.promiseKeptRate7d * 100) : null;

  return (
    <div className="mb-4 space-y-4">
      {/* Section: ของฉันวันนี้ — personal */}
      {!todayKpi.isError && (
        <div className="rounded-2xl border border-border/50 bg-card shadow-sm overflow-hidden">
          <SectionTitle>ของฉันวันนี้</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 px-1 pb-2">
            <Metric
              icon={Phone}
              iconBg="bg-primary/10"
              iconColor="text-primary"
              label="โทรวันนี้"
              value={today?.callsToday?.toString() ?? '-'}
              unit={today ? `/ ${today.callsTarget}` : undefined}
              progress={callProgress}
              progressBarClass="bg-primary"
              loading={todayKpi.isLoading}
              onClick={() => goToday({ lastContacted: 'today' })}
            />
            <Metric
              icon={MessageCircle}
              iconBg="bg-info/10"
              iconColor="text-info"
              label="LINE ที่ส่งไปวันนี้"
              value={today?.lineSentToday?.toString() ?? '-'}
              unit="ราย"
              loading={todayKpi.isLoading}
              onClick={() => goToday({ lineResponse: 'responded' })}
            />
            <Metric
              icon={Handshake}
              iconBg="bg-warning/10"
              iconColor="text-warning"
              label="นัดชำระสำเร็จ"
              value={today?.promisesKeptToday?.toString() ?? '-'}
              unit="ราย"
              loading={todayKpi.isLoading}
              onClick={() => goToday({ hasActivePromise: true })}
            />
            <Metric
              icon={CircleDollarSign}
              iconBg="bg-success/10"
              iconColor="text-success"
              label="เก็บเงินได้วันนี้"
              value={collected}
              unit="฿"
              loading={todayKpi.isLoading}
              onClick={() => onSwitchToToday()}
            />
          </div>
        </div>
      )}

      {/* Section: ภาพรวม 7 วัน — system */}
      <div className="rounded-2xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <SectionTitle>ภาพรวม 7 วันล่าสุด</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 px-1 pb-2">
          <Metric
            icon={CircleDollarSign}
            iconBg="bg-destructive/10"
            iconColor="text-destructive"
            label="ค้างชำระทั้งหมด"
            value={sys ? formatNumber(sys.totalOutstanding) : '-'}
            unit="฿"
            valueClass="text-destructive"
            sublabel={
              sys ? `รวมค่าปรับล่าช้า ${formatNumber(sys.totalLateFees)} ฿` : undefined
            }
            loading={sysKpi.isLoading}
            loadingWidth="w-32"
          />
          <Metric
            icon={Phone}
            iconBg="bg-primary/10"
            iconColor="text-primary"
            label="คิววันนี้ทั้งหมด"
            value={sys?.queueToday?.toString() ?? '-'}
            unit="ราย"
            valueClass="text-primary"
            sublabel={
              trend !== 0 ? (
                <span
                  className={`inline-flex items-center gap-1 font-medium ${
                    trend > 0 ? 'text-destructive' : 'text-success'
                  }`}
                >
                  {trend > 0 ? (
                    <TrendingUp className="size-3.5" />
                  ) : (
                    <TrendingDown className="size-3.5" />
                  )}
                  {trend > 0 ? 'เพิ่มขึ้น' : 'ลดลง'} {Math.abs(trend).toFixed(0)}%
                </span>
              ) : (
                'เทียบสัปดาห์ที่แล้ว'
              )
            }
            loading={sysKpi.isLoading}
          />
          <Metric
            icon={Handshake}
            iconBg="bg-warning/10"
            iconColor="text-warning"
            label="รอชำระตามนัด"
            value={sys?.promisedCount?.toString() ?? '-'}
            unit="ราย"
            valueClass="text-warning"
            loading={sysKpi.isLoading}
          />
          <Metric
            icon={CircleDollarSign}
            iconBg="bg-success/10"
            iconColor="text-success"
            label="นัดแล้วจ่ายตรง"
            value={promiseRate !== null ? `${promiseRate}%` : '-'}
            valueClass="text-success"
            sublabel="7 วันล่าสุด"
            loading={sysKpi.isLoading}
          />
        </div>
      </div>

      {/* Collector workload — OWNER only */}
      {isOwner && sys?.collectorWorkload && sys.collectorWorkload.length > 0 && (
        <div className="rounded-2xl border border-border/50 bg-card shadow-sm px-4 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="size-4 text-primary" />
            <span className="text-sm font-semibold text-foreground leading-snug">
              ผู้ติดตามหนี้
            </span>
            <span className="text-sm text-muted-foreground leading-snug">(งานยังไม่ปิด)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {sys.collectorWorkload.map((w) => (
              <div
                key={w.userId}
                className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-1.5"
              >
                <span className="text-sm font-semibold leading-snug">{w.name}</span>
                <span className="text-sm text-muted-foreground leading-snug">·</span>
                <span className="text-sm font-medium tabular-nums leading-snug">
                  {w.count} ราย
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatBahtCompact(decimalString: string): string {
  const n = Number(decimalString);
  if (!Number.isFinite(n)) return '-';
  return Math.round(n).toLocaleString();
}
