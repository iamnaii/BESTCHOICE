import { useEffect, useState } from 'react';

interface Props {
  startedAt: Date;
  targetMinutes: number;
}

/**
 * Live elapsed timer with color-coded over-target state.
 * Goes amber at 100% target, red at 130%.
 */
export default function SessionTimer({ startedAt, targetMinutes }: Props) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedMs = Math.max(0, now.getTime() - startedAt.getTime());
  const elapsedMin = Math.floor(elapsedMs / 60000);
  const elapsedSec = Math.floor((elapsedMs % 60000) / 1000);
  const ratio = elapsedMin / Math.max(1, targetMinutes);
  const color =
    ratio >= 1.3 ? 'text-destructive' : ratio >= 1 ? 'text-warning' : 'text-muted-foreground';

  return (
    <span className={`font-mono tabular-nums text-sm leading-snug ${color}`}>
      {String(elapsedMin).padStart(2, '0')}:{String(elapsedSec).padStart(2, '0')}
      <span className="text-2xs text-muted-foreground/60 ml-1">
        / {String(targetMinutes).padStart(2, '0')}:00
      </span>
    </span>
  );
}
