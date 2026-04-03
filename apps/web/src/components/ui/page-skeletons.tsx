import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton patterns ที่ match กับ layout จริงของแต่ละหน้า
 * ใช้แทน spinner เมื่อโหลดข้อมูล — ให้ user เห็น layout ที่จะเกิดขึ้น (Metronic pattern)
 */

/** Dashboard: KPI banner + shortcut cards + charts */
export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5 lg:gap-7 animate-in fade-in-0 duration-300">
      {/* Page title */}
      <div>
        <Skeleton className="h-6 w-32 mb-1.5" />
        <Skeleton className="h-4 w-56" />
      </div>

      {/* KPI Banner */}
      <Skeleton className="h-[140px] rounded-xl" />

      {/* Two column: shortcuts + revenue */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-7">
        <div className="lg:col-span-5">
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[120px] rounded-xl" />
            ))}
          </div>
        </div>
        <div className="lg:col-span-7 space-y-5">
          <Skeleton className="h-[200px] rounded-xl" />
          <Skeleton className="h-[200px] rounded-xl" />
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-7">
        <Skeleton className="lg:col-span-7 h-[340px] rounded-xl" />
        <Skeleton className="lg:col-span-5 h-[340px] rounded-xl" />
      </div>
    </div>
  );
}

/** Detail page: header + info cards + tabs */
export function DetailPageSkeleton() {
  return (
    <div className="flex flex-col gap-5 animate-in fade-in-0 duration-300">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-6 w-44 mb-1.5" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 rounded-lg" />
          <Skeleton className="h-9 w-24 rounded-lg" />
        </div>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>

      {/* Tabs */}
      <Skeleton className="h-10 w-80 rounded-lg" />

      {/* Content area */}
      <Skeleton className="h-[400px] rounded-xl" />
    </div>
  );
}

/** List page: filters + table */
export function ListPageSkeleton() {
  return (
    <div className="flex flex-col gap-5 animate-in fade-in-0 duration-300">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-6 w-36 mb-1.5" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex gap-3">
        <Skeleton className="h-9 flex-1 max-w-sm rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="flex gap-4 px-5 py-3.5 bg-muted/50 border-b border-border">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-3 flex-1 rounded" />
          ))}
        </div>
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="flex gap-4 px-5 py-3.5 border-b border-border last:border-0">
            {[1, 2, 3, 4, 5].map((j) => (
              <Skeleton key={j} className="h-4 flex-1 rounded" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Form page: stepper + form fields */
export function FormPageSkeleton() {
  return (
    <div className="flex flex-col gap-5 animate-in fade-in-0 duration-300">
      {/* Header */}
      <div>
        <Skeleton className="h-6 w-48 mb-1.5" />
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-4 mb-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 flex-1">
            <Skeleton className="size-10 rounded-xl shrink-0" />
            <div className="hidden md:block">
              <Skeleton className="h-3 w-12 mb-1" />
              <Skeleton className="h-4 w-20" />
            </div>
            {i < 4 && <Skeleton className="flex-1 h-0.5 mx-4" />}
          </div>
        ))}
      </div>

      {/* Form card */}
      <Skeleton className="h-[400px] rounded-xl" />

      {/* Navigation buttons */}
      <div className="flex justify-between pt-6 border-t border-border">
        <Skeleton className="h-10 w-28 rounded-lg" />
        <Skeleton className="h-10 w-28 rounded-lg" />
      </div>
    </div>
  );
}

/** Card grid (POS / Stock) */
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-[100px] rounded-xl" />
      ))}
    </div>
  );
}
