export function StockIndicator({ display, tone }: { display: string; tone: string }) {
  const colorClass =
    tone === 'urgent'
      ? 'text-red-600 bg-red-50'
      : tone === 'low'
        ? 'text-orange-600 bg-orange-50'
        : tone === 'out'
          ? 'text-muted-foreground bg-muted'
          : 'text-primary bg-primary/10';
  return (
    <span className={`inline-block px-2 py-1 rounded text-xs ${colorClass}`}>{display}</span>
  );
}
