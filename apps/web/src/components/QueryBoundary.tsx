import { ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface QueryBoundaryProps {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
  loadingFallback?: ReactNode;
  errorTitle?: string;
  errorMessage?: string;
  children: ReactNode;
}

/**
 * Standard wrapper for React Query pages: handles loading and error states
 * consistently so individual pages don't each reinvent the spinner/retry UI.
 *
 * Usage:
 *   const q = useQuery({ queryKey: ['customers'], queryFn: fetchCustomers });
 *   return (
 *     <QueryBoundary
 *       isLoading={q.isLoading}
 *       isError={q.isError}
 *       error={q.error}
 *       onRetry={q.refetch}
 *     >
 *       <CustomersTable data={q.data!} />
 *     </QueryBoundary>
 *   );
 */
export default function QueryBoundary({
  isLoading,
  isError,
  error,
  onRetry,
  loadingFallback,
  errorTitle = 'ไม่สามารถโหลดข้อมูลได้',
  errorMessage,
  children,
}: QueryBoundaryProps) {
  if (isLoading) {
    return (
      <>
        {loadingFallback ?? (
          <div
            className="flex items-center justify-center py-16"
            role="status"
            aria-label="กำลังโหลด"
          >
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}
      </>
    );
  }

  if (isError) {
    const detail =
      errorMessage ??
      (error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    return (
      <div
        className="flex flex-col items-center justify-center py-16 px-6 text-center"
        role="alert"
      >
        <AlertCircle className="h-10 w-10 text-destructive mb-3" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-foreground mb-1">{errorTitle}</h2>
        <p className="text-sm text-muted-foreground max-w-md mb-4">{detail}</p>
        {onRetry && (
          <button
            type="button"
            onClick={() => onRetry()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            ลองใหม่
          </button>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
