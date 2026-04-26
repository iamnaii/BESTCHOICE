import { useEffect, useState } from 'react';

interface Props {
  startedAt: Date;
  targetMinutes: number;
  /** Cumulative milliseconds spent paused — subtracted from wall-clock elapsed. */
  pausedMs?: number;
  /** When non-null, the timer is currently paused since this Date — freeze display. */
  pausedAt?: Date | null;
}

/**
 * Live elapsed timer. Subtracts paused duration so pausing actually pauses.
 * - When NOT paused: elapsed = (now - startedAt) - pausedMs
 * - When paused: elapsed = (pausedAt - startedAt) - pausedMs
 */
export default function SessionTimer({
  startedAt,
  targetMinutes,
  pausedMs = 0,
  pausedAt = null,
}: Props) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (pausedAt) return; // freeze ticker while paused
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [pausedAt]);

  const reference = pausedAt ?? now;
  const elapsedMs = Math.max(0, reference.getTime() - startedAt.getTime() - pausedMs);
  const elapsedMin = Math.floor(elapsedMs / 60000);
  const elapsedSec = Math.floor((elapsedMs % 60000) / 1000);
  const ratio = elapsedMin / Math.max(1, targetMinutes);
  const color = pausedAt
    ? 'text-muted-foreground/60'
    : ratio >= 1.3
      ? 'text-destructive'
      : ratio >= 1
        ? 'text-warning'
        : 'text-muted-foreground';

  return (
    <span className={`font-mono tabular-nums text-sm leading-snug ${color}`}>
      {pausedAt && <span className="text-2xs uppercase tracking-wider mr-1">หยุดพัก</span>}
      {String(elapsedMin).padStart(2, '0')}:{String(elapsedSec).padStart(2, '0')}
      <span className="text-2xs text-muted-foreground/60 ml-1">
        / {String(targetMinutes).padStart(2, '0')}:00
      </span>
    </span>
  );
}
