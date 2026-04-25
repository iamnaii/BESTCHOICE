import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TruncatedBannerProps {
  /**
   * Callback to open the filter drawer. Task 10 will wire this to a real
   * drawer; during P0 this may be a no-op or a stub toast.
   */
  onOpenFilter: () => void;
}

/**
 * Amber banner shown when backend queue capped results at 500 rows.
 * Nudges the user to narrow filter before the UI silently hides tail rows.
 */
export function TruncatedBanner({ onOpenFilter }: TruncatedBannerProps) {
  return (
    <div
      role="alert"
      className="mb-3 flex items-center justify-between rounded-md border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
        <span className="text-foreground leading-snug">
          แสดง 500 แถวแรก — ปรับ filter ให้แคบลงเพื่อเห็นทั้งหมด
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={onOpenFilter}>
        เปิด filter
      </Button>
    </div>
  );
}

export default TruncatedBanner;
