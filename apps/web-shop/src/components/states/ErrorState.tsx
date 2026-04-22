import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'เกิดข้อผิดพลาด',
  description = 'ลองกดโหลดใหม่อีกครั้ง หรือเปิดหน้านี้ใหม่',
  onRetry,
}: Props) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4 leading-snug">
      <AlertCircle className="size-12 text-destructive mb-4" aria-hidden="true" />
      <h3 className="text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground max-w-sm">{description}</p>
      {onRetry && (
        <Button variant="outline" className="mt-6" onClick={onRetry} size="lg">
          <RefreshCw className="size-4" /> โหลดใหม่
        </Button>
      )}
    </div>
  );
}
