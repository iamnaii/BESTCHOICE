import { useMemo, useState } from 'react';
import { PhoneCall, Banknote, MessageCircle, Activity, Lock, FileText } from 'lucide-react';
import { EventTimeline } from '@/components/timeline/EventTimeline';
import type { EventStyle } from '@/components/timeline/eventTimelineStyles';
import { DateRangePicker, type DateRangeValue } from '@/components/ui/DateRangePicker';
import type { TimelineEvent } from '../hooks/useCustomer360';
import TimelineFilterChips from './TimelineFilterChips';
import VoiceMemoPlayback from './VoiceMemoPlayback';

// ─── icon/color config ───────────────────────────────────────────────────────

function getEventStyle(event: TimelineEvent): EventStyle {
  // CALL: override based on result metadata
  if (event.type === 'CALL') {
    const result = event.metadata?.result as string | undefined;
    if (result === 'PROMISED') {
      return { Icon: PhoneCall, iconBg: 'bg-success/10', iconText: 'text-success', typeLabel: 'โทร' };
    }
    if (result === 'REFUSED') {
      return { Icon: PhoneCall, iconBg: 'bg-destructive/10', iconText: 'text-destructive', typeLabel: 'โทร' };
    }
    return { Icon: PhoneCall, iconBg: 'bg-primary/10', iconText: 'text-primary', typeLabel: 'โทร' };
  }

  switch (event.type) {
    case 'PAYMENT':
      return { Icon: Banknote, iconBg: 'bg-success/10', iconText: 'text-success', typeLabel: 'ชำระ' };
    case 'DUNNING_ACTION':
      return { Icon: MessageCircle, iconBg: 'bg-primary/10', iconText: 'text-primary', typeLabel: 'แจ้งเตือน' };
    case 'STATUS_CHANGE':
      return { Icon: Activity, iconBg: 'bg-muted', iconText: 'text-muted-foreground', typeLabel: 'สถานะ' };
    case 'MDM':
      return { Icon: Lock, iconBg: 'bg-destructive/10', iconText: 'text-destructive', typeLabel: 'เครื่อง' };
    case 'LETTER':
      return { Icon: FileText, iconBg: 'bg-warning/10', iconText: 'text-warning', typeLabel: 'หนังสือ' };
    default:
      return { Icon: Activity, iconBg: 'bg-muted', iconText: 'text-muted-foreground', typeLabel: event.type };
  }
}

// P2 Task 4 — voice memo playback inline (CALL events only)
function renderVoiceMemo(event: TimelineEvent) {
  if (event.type !== 'CALL') return null;
  const voiceMemoUrl = event.metadata?.voiceMemoUrl as string | undefined;
  if (!voiceMemoUrl) return null;
  return (
    <VoiceMemoPlayback
      voiceMemoUrl={voiceMemoUrl}
      tier={event.metadata?.voiceMemoTier as string | undefined}
      callLogId={event.metadata?.callLogId as string | undefined}
    />
  );
}

// ─── main component ──────────────────────────────────────────────────────────

interface Props {
  events: TimelineEvent[];
}

export default function Customer360Timeline({ events }: Props) {
  const [filterType, setFilterType] = useState<string>('ALL');
  const [dateRange, setDateRange] = useState<DateRangeValue>({ from: null, to: null });

  // Counts per type — computed from full event set so chips show stable totals
  const counts = useMemo(() => {
    const c: Partial<Record<string, number>> = { ALL: events.length };
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

      <EventTimeline
        events={filteredEvents}
        getStyle={getEventStyle}
        renderExtra={renderVoiceMemo}
        emptyText={events.length === 0 ? 'ยังไม่มีกิจกรรม' : 'ไม่พบกิจกรรมตามตัวกรอง'}
        footer={
          // Cap notice — only when not filtering (full result hits cap)
          !hasAnyFilter && events.length >= 100 ? (
            <div className="pt-3 text-center text-xs text-muted-foreground leading-snug">แสดง 100 รายการล่าสุด</div>
          ) : null
        }
      />
    </div>
  );
}
