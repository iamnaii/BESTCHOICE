interface Props {
  total: number;
  target: number;
}

export default function PlanProgressBar({ total, target }: Props) {
  const pct = target > 0 ? Math.min(100, Math.round((total / target) * 100)) : 0;
  return (
    <div className="space-y-1 leading-snug">
      <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>฿{total.toLocaleString()}</span>
        <span>{pct}%</span>
        <span>฿{target.toLocaleString()}</span>
      </div>
    </div>
  );
}
