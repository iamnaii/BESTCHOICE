import { Sun, Sunset, Moon, Phone, MessageCircle, Smartphone, Circle } from 'lucide-react';
import type { CustomerInsights, ContactTimeBucket, InsightChannel } from '../hooks/useCustomerInsights';

interface Props {
  insights: CustomerInsights | null | undefined;
}

/**
 * SmartCustomerPanel — three quick-glance badges below the customer name in
 * Customer 360 (P2 Task 5). Renders nothing if insights are still loading or
 * the customer has no signal at all.
 */
export default function SmartCustomerPanel({ insights }: Props) {
  if (!insights) return null;
  const { preferredContactTime, preferredChannel, lineOnlineAt } = insights;

  const showAnything =
    preferredContactTime || preferredChannel || lineOnlineAt;
  if (!showAnything) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {preferredContactTime && <TimeBadge bucket={preferredContactTime} />}
      {preferredChannel && (
        <ChannelBadge
          channel={preferredChannel}
          rate={insights.channelResponseRates[preferredChannel]}
        />
      )}
      {lineOnlineAt && <LineOnlineBadge lineOnlineAt={lineOnlineAt} />}
    </div>
  );
}

function TimeBadge({ bucket }: { bucket: ContactTimeBucket }) {
  const cfg = TIME_CFG[bucket];
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-accent text-foreground px-2 py-0.5 text-xs leading-snug"
      title="ช่วงเวลาที่รับสายบ่อยที่สุด"
    >
      <Icon className="size-3" />
      รับสาย: {cfg.label}
    </span>
  );
}

function ChannelBadge({
  channel,
  rate,
}: {
  channel: InsightChannel;
  rate?: number;
}) {
  const cfg = CHANNEL_CFG[channel];
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs leading-snug"
      title="ช่องทางที่มีอัตราการตอบสูงสุด"
    >
      <Icon className="size-3" />
      {cfg.label}
      {typeof rate === 'number' ? ` ${rate}%` : ''}
    </span>
  );
}

function LineOnlineBadge({ lineOnlineAt }: { lineOnlineAt: string }) {
  const ts = new Date(lineOnlineAt);
  const ageMs = Date.now() - ts.getTime();
  const fresh = ageMs <= 5 * 60_000; // within 5 minutes
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs leading-snug ${
        fresh ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
      }`}
      title={`LINE online ล่าสุด: ${ts.toLocaleString('th-TH')}`}
    >
      <Circle className={`size-2 ${fresh ? 'fill-success text-success' : 'fill-muted-foreground'}`} />
      LINE {fresh ? 'online' : formatRelative(ageMs)}
    </span>
  );
}

const TIME_CFG: Record<ContactTimeBucket, { label: string; icon: typeof Sun }> = {
  MORNING: { label: 'เช้า', icon: Sun },
  AFTERNOON: { label: 'บ่าย', icon: Sunset },
  EVENING: { label: 'เย็น', icon: Moon },
};

const CHANNEL_CFG: Record<InsightChannel, { label: string; icon: typeof Phone }> = {
  LINE: { label: 'LINE', icon: MessageCircle },
  SMS: { label: 'SMS', icon: Smartphone },
  CALL: { label: 'โทร', icon: Phone },
};

function formatRelative(ageMs: number): string {
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 60) return `${mins} นาทีก่อน`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ชม.ก่อน`;
  const days = Math.floor(hrs / 24);
  return `${days} วันก่อน`;
}
