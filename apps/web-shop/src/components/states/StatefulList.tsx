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
  if (isLoading) return <LoadingState variant={loadingVariant} />;
  if (isError) return <ErrorState onRetry={onRetry} />;
  if (!data || data.length === 0) return <EmptyState {...emptyState} />;
  return <div className={wrapperClassName}>{data.map((item, i) => renderItem(item, i))}</div>;
}
