interface Props {
  current: number;
  total: number;
}

export default function SessionProgress({ current, total }: Props) {
  const pct = total === 0 ? 0 : Math.round((current / total) * 100);
  return (
    <div className="flex items-center gap-3 min-w-[140px]">
      <div className="font-mono tabular-nums text-sm tracking-tight whitespace-nowrap leading-snug">
        {current} <span className="text-muted-foreground">/ {total}</span>
      </div>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
