import { Skeleton } from '@/components/ui/skeleton';

interface Props {
  rows?: number;
  variant?: 'card-grid' | 'list' | 'detail';
  /** Grid classes of the list this stands in for, so the column count matches. */
  gridClassName?: string;
}

const DEFAULT_GRID = 'grid grid-cols-2 lg:grid-cols-3 gap-2.5 md:gap-3';

export function LoadingState({ rows = 6, variant = 'card-grid', gridClassName }: Props) {
  if (variant === 'card-grid') {
    // Mirrors ProductCard's real geometry (full-bleed square photo, three text
    // rows, capsule CTA) so the grid does not jump when data lands.
    return (
      <div className={gridClassName || DEFAULT_GRID}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-2xl md:rounded-3xl border border-border bg-card/60"
          >
            <Skeleton className="aspect-square w-full rounded-none" />
            <div className="px-2.5 pt-2.5 pb-2.5 sm:px-3.5 sm:pt-3 sm:pb-3.5 space-y-2">
              <Skeleton shape="line" className="h-4 w-3/4" />
              <Skeleton shape="line" className="h-3 w-1/2" />
              <Skeleton shape="line" className="h-5 w-2/3" />
              <Skeleton className="h-9 w-full rounded-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (variant === 'list') {
    return (
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} shape="line" className="h-16" />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <Skeleton shape="thumbnail" className="aspect-video max-w-2xl" />
      <div className="space-y-2">
        <Skeleton shape="line" />
        <Skeleton shape="line" className="w-3/4" />
        <Skeleton shape="line" className="w-1/2" />
      </div>
    </div>
  );
}
