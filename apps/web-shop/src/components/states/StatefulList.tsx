import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';

interface StatefulListProps<T> {
  isLoading: boolean;
  isError: boolean;
  data: T[] | undefined;
  renderItem: (item: T, index: number) => React.ReactNode;
  emptyState: Omit<React.ComponentProps<typeof EmptyState>, 'children'>;
  onRetry?: () => void;
  loadingVariant?: 'card-grid' | 'list' | 'detail';
  wrapperClassName?: string;
}

export function StatefulList<T>({
  isLoading,
  isError,
  data,
  renderItem,
  emptyState,
  onRetry,
  loadingVariant = 'card-grid',
  wrapperClassName,
}: StatefulListProps<T>) {
  // The skeleton reuses the caller's own grid classes so column counts match
  // between loading and loaded — otherwise the grid reflows the moment data lands.
  if (isLoading) return <LoadingState variant={loadingVariant} gridClassName={wrapperClassName} />;
  if (isError) return <ErrorState onRetry={onRetry} />;
  if (!data || data.length === 0) return <EmptyState {...emptyState} />;
  return <div className={wrapperClassName}>{data.map((item, i) => renderItem(item, i))}</div>;
}
