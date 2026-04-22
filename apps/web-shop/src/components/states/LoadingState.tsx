import { Skeleton } from '@/components/ui/skeleton';

interface Props {
  rows?: number;
  variant?: 'card-grid' | 'list' | 'detail';
}

export function LoadingState({ rows = 6, variant = 'card-grid' }: Props) {
  if (variant === 'card-grid') {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-3">
            <Skeleton shape="thumbnail" />
            <Skeleton shape="line" />
            <Skeleton shape="line" className="w-2/3" />
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
