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
    // Mirrors ProductCard's real geometry (glass shell, 4:3 plate, thumb strip,
    // three text rows, capsule CTA) so the grid does not jump when data lands.
    return (
      <div className={gridClassName || DEFAULT_GRID}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="rounded-[26px] md:rounded-[30px] border border-card bg-card/60 p-2 md:p-2.5"
          >
            <Skeleton className="aspect-[4/3] w-full rounded-[20px] md:rounded-3xl" />
            <div className="hidden sm:flex gap-1.5 mt-2">
              {Array.from({ length: 4 }).map((__, j) => (
                <Skeleton key={j} className="flex-1 aspect-square rounded-xl" />
              ))}
            </div>
            <div className="px-1 pt-2.5 space-y-2">
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
