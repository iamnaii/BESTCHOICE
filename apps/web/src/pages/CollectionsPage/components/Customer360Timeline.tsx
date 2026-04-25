import { useMemo, useState } from 'react';
import {
  PhoneCall,
  Banknote,
  MessageCircle,
  Activity,
  Lock,
  FileText,
  type LucideIcon,
} from 'lucide-react';
import type { TimelineEvent } from '../hooks/useCustomer360';
import TimelineFilterChips, {
  type TimelineFilterValue,
} from './TimelineFilterChips';
import { DateRangePicker, type DateRangeValue } from '@/components/ui/DateRangePicker';

// ─── helpers ────────────────────────────────────────────────────────────────

function groupByDate(events: TimelineEvent[]): Array<{ label: string; items: TimelineEvent[] }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 86_400_000);
  const groups = new Map<string, TimelineEvent[]>();
  const order: string[] = [];

  for (const e of events) {
    const d = new Date(e.timestamp);
    d.setHours(0, 0, 0, 0);
    let label: string;
    if (d.getTime() === today.getTime()) {
      label = 'วันนี้';
    } else if (d.getTime() === yesterday.getTime()) {
      label = 'เมื่อวาน';
    } else {
      label = d.toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    }

    if (!groups.has(label)) {
      groups.set(label, []);
      order.push(label);
    }
    groups.get(label)!.push(e);
  }

  return order.map((label) => ({ label, items: groups.get(label)! }));
}

function timeLabel(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const mins = Math.floor((now - t) / 60_000);
  if (mins < 1) return 'ตอนนี้';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ชม.ที่แล้ว`;
  return new Date(iso).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// ─── icon/color config ───────────────────────────────────────────────────────

interface EventStyle {
  Icon: LucideIcon;
  iconBg: string;
  iconText: string;
  typeLabel: string;
}

function getEventStyle(event: TimelineEvent): EventStyle {
  // CALL: override based on result metadata
  if (event.type === 'CALL') {
    const result = event.metadata?.result as string | undefined;
    if (result === 'PROMISED') {
      return {
        Icon: PhoneCall,
        iconBg: 'bg-success/10',
        iconText: 'text-success',
        typeLabel: 'โทร',
      };
    }
    if (result === 'REFUSED') {
      return {
        Icon: PhoneCall,
        iconBg: 'bg-destructive/10',
        iconText: 'text-destructive',
        typeLabel: 'โทร',
      };
    }
    return {
      Icon: PhoneCall,
      iconBg: 'bg-primary/10',
      iconText: 'text-primary',
      typeLabel: 'โทร',
    };
  }

  switch (event.type) {
    case 'PAYMENT':
      return {
        Icon: Banknote,
        iconBg: 'bg-success/10',
        iconText: 'text-success',
        typeLabel: 'ชำระ',
      };
    case 'DUNNING_ACTION':
      return {
        Icon: MessageCircle,
        iconBg: 'bg-primary/10',
        iconText: 'text-primary',
        typeLabel: 'แจ้งเตือน',
      };
    case 'STATUS_CHANGE':
      return {
        Icon: Activity,
        iconBg: 'bg-muted',
        iconText: 'text-muted-foreground',
        typeLabel: 'สถานะ',
      };
    case 'MDM':
      return {
        Icon: Lock,
        iconBg: 'bg-destructive/10',
        iconText: 'text-destructive',
        typeLabel: 'เครื่อง',
      };
    case 'LETTER':
      return {
        Icon: FileText,
        iconBg: 'bg-warning/10',
        iconText: 'text-warning',
        typeLabel: 'หนังสือ',
      };
    default:
      return {
        Icon: Activity,
        iconBg: 'bg-muted',
        iconText: 'text-muted-foreground',
        typeLabel: event.type,
      };
  }
}

// ─── sub-components ──────────────────────────────────────────────────────────

function EventCard({ event, isFirst }: { event: TimelineEvent; isFirst: boolean }) {
  const { Icon, iconBg, iconText, typeLabel } = getEventStyle(event);
  const label = timeLabel(event.timestamp);

  return (
    <div
      className={`flex gap-3 px-1 py-2.5 rounded-lg hover:bg-muted/40 transition-colors ${
        isFirst ? '' : ''
      }`}
    >
      {/* Icon circle */}
      <div
        className={`shrink-0 mt-0.5 size-8 rounded-full flex items-center justify-center ${iconBg}`}
      >
        <Icon className={`size-4 ${iconText}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 text-xs text-muted-foreground mb-0.5">
          <span className="tabular-nums leading-snug">{label}</span>
          <span className="text-[10px] uppercase tracking-wider leading-snug shrink-0">
            {typeLabel}
          </span>
        </div>
        <div className="text-sm font-medium leading-snug truncate">{event.title}</div>
        {event.subtitle && (
          <div className="text-xs text-muted-foreground mt-0.5 truncate leading-snug">
            {event.subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

interface Props {
  events: TimelineEvent[];
}

export default function Customer360Timeline({ events }: Props) {
  const [filterType, setFilterType] = useState<TimelineFilterValue>('ALL');
  const [dateRange, setDateRange] = useState<DateRangeValue>({ from: null, to: null });

  // Counts per type — computed from full event set so chips show stable totals
  const counts = useMemo(() => {
    const c: Partial<Record<TimelineFilterValue, number>> = { ALL: events.length };
    for (const e of events) {
      c[e.type] = (c[e.type] ?? 0) + 1;
    }
    return c;
  }, [events]);

  // Apply in-memory filter (timeline capped at 100 events backend-side)
  const filteredEvents = useMemo(() => {
    const fromMs = dateRange.from ? dateRange.from.getTime() : null;
    const toMs = dateRange.to ? dateRange.to.getTime() : null;
    return events.filter((e) => {
      if (filterType !== 'ALL' && e.type !== filterType) return false;
      if (fromMs !== null || toMs !== null) {
        const t = new Date(e.timestamp).getTime();
        if (fromMs !== null && t < fromMs) return false;
        if (toMs !== null && t > toMs) return false;
      }
      return true;
    });
  }, [events, filterType, dateRange]);

  const hasDateFilter = dateRange.from !== null || dateRange.to !== null;
  const hasAnyFilter = filterType !== 'ALL' || hasDateFilter;

  return (
    <div className="space-y-3">
      {/* Filter controls */}
      <div className="space-y-2">
        <TimelineFilterChips value={filterType} onChange={setFilterType} counts={counts} />
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {/* Empty states */}
      {events.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground leading-snug">
          ยังไม่มีกิจกรรม
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground leading-snug">
          ไม่พบกิจกรรมตามตัวกรอง
        </div>
      ) : (
        <div className="space-y-1">
          {groupByDate(filteredEvents).map((group, groupIdx) => (
            <div key={group.label}>
              {/* Section header */}
              <div
                className={`text-xs uppercase tracking-wider text-muted-foreground mb-1 leading-snug ${
                  groupIdx === 0 ? '' : 'mt-4'
                }`}
              >
                {group.label}
              </div>

              {/* Events */}
              <div>
                {group.items.map((event, idx) => (
                  <EventCard key={event.id} event={event} isFirst={idx === 0} />
                ))}
              </div>
            </div>
          ))}

          {/* Cap notice — only when not filtering (full result hits cap) */}
          {!hasAnyFilter && events.length >= 100 && (
            <div className="pt-3 text-center text-xs text-muted-foreground leading-snug">
              แสดง 100 รายการล่าสุด
            </div>
          )}
        </div>
      )}
    </div>
  );
}
