import { Phone, MessageCircle, Handshake, CircleDollarSign, type LucideIcon } from 'lucide-react';
import { useMyTodayKpi } from '../hooks/useMyTodayKpi';
import { useQueueFilter } from '../hooks/useQueueFilter';

interface Props {
  /**
   * Switch the parent CollectionsPage to the "today" queue tab when a chip
   * is clicked, so the URL filter we set actually takes effect on the page
   * the user is now looking at.
   */
  onSwitchToToday: () => void;
}

interface ChipProps {
  icon: LucideIcon;
  label: string;
  value: string;
  /** Optional muted tail label, e.g. "/ 20" for the calls target. */
  trailing?: string;
  loading?: boolean;
  onClick?: () => void;
  /** When true the chip is rendered as a non-interactive readout. */
  disabled?: boolean;
}

function Chip({ icon: Icon, label, value, trailing, loading, onClick, disabled }: ChipProps) {
  const interactive = !disabled && !!onClick;
  const Tag = interactive ? 'button' : ('div' as const);
  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={interactive ? onClick : undefined}
      className={`flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-left transition-colors ${
        interactive ? 'hover:bg-accent hover:border-border cursor-pointer' : ''
      }`}
    >
      <Icon className="size-4 text-muted-foreground shrink-0" aria-hidden />
      <div className="flex flex-col leading-tight min-w-0">
        <span className="text-2xs uppercase tracking-wider text-muted-foreground leading-snug">
          {label}
        </span>
        {loading ? (
          <span className="mt-0.5 h-4 w-12 rounded bg-muted animate-pulse" />
        ) : (
          <span className="text-sm font-semibold tabular-nums leading-snug">
            {value}
            {trailing && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">{trailing}</span>
            )}
          </span>
        )}
      </div>
    </Tag>
  );
}

/**
 * P2 Task 1 — "what have I done today?" mini-strip on the Collections page
 * header, between PageHeader and the tab bar. Chips click through to the
 * Queue tab with a relevant URL filter pre-applied so the operator can
 * inspect the underlying rows. Polled every 5 minutes by the hook.
 */
export default function DailyProgressStrip({ onSwitchToToday }: Props) {
  const { data, isLoading, isError } = useMyTodayKpi();
  const [, setFilter] = useQueueFilter('queue');

  if (isError) {
    // Soft-fail: header strip should never block the page; the main KPI
    // strip below already shows a retry surface for connectivity issues.
    return null;
  }

  // Format Decimal-precise string into ฿1,234 (no decimals — chips are tight).
  const collected = data ? formatBahtCompact(data.collectedTodayBaht) : '-';

  const goToday = (patch: Parameters<typeof setFilter>[0]) => {
    onSwitchToToday();
    setFilter(patch);
  };

  return (
    <div
      className="mb-4 flex flex-wrap gap-2"
      aria-label="กิจกรรมวันนี้ของฉัน"
    >
      <Chip
        icon={Phone}
        label="โทรวันนี้"
        value={data?.callsToday?.toString() ?? '-'}
        trailing={data ? `/ ${data.callsTarget}` : undefined}
        loading={isLoading}
        onClick={() => goToday({ lastContacted: 'today' })}
      />
      <Chip
        icon={MessageCircle}
        label="LINE ส่งวันนี้"
        value={data?.lineSentToday?.toString() ?? '-'}
        loading={isLoading}
        onClick={() => goToday({ lineResponse: 'responded' })}
      />
      <Chip
        icon={Handshake}
        label="นัดชำระวันนี้สำเร็จ"
        value={data?.promisesKeptToday?.toString() ?? '-'}
        loading={isLoading}
        onClick={() => goToday({ hasActivePromise: true })}
      />
      <Chip
        icon={CircleDollarSign}
        label="เก็บได้วันนี้"
        value={collected}
        trailing="฿"
        loading={isLoading}
        // Collected-today has no direct queue filter — clicking takes the
        // user back to the today queue without changing filters.
        onClick={() => onSwitchToToday()}
      />
    </div>
  );
}

function formatBahtCompact(decimalString: string): string {
  // The wire format is "12345.67" — drop fractional part for chip density.
  const n = Number(decimalString);
  if (!Number.isFinite(n)) return '-';
  return Math.round(n).toLocaleString();
}
