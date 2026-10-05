import type { ChatStaffMetrics } from '@installment/shared';
import { Button } from '@/components/ui/button';
import { formatMetric } from './analytics-format';
export default function StaffPerformanceTable({
  data,
  total,
  page,
  onPage,
  onStaff,
}: {
  data: ChatStaffMetrics[];
  total: number;
  page: number;
  onPage: (n: number) => void;
  onStaff: (staff: ChatStaffMetrics) => void;
}) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h3 className="font-semibold">ผู้ตอบจริง</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        เฉพาะคำตอบที่ส่งสำเร็จ · เจ้าของห้องกับเจ้าของยอดขายเป็นคนละบทบาท
      </p>
      <div className="mt-3 divide-y">
        {data.length ? (
          data.map((row) => (
            <button
              key={row.staffId ?? 'unknown'}
              type="button"
              className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-left hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onStaff(row)}
            >
              <span className="min-w-0">
                <b className="block break-words">{row.name}</b>
                <span className="text-xs text-muted-foreground">
                  ตอบ {row.nResponded} รอบ · วัดเวลาได้ {row.humanSamples} รอบ
                </span>
              </span>
              <span className="text-sm tabular-nums">
                Median {formatMetric(row.humanMedianMinutes, 'นาที')}
                <span className="block text-xs text-muted-foreground">
                  p90 {formatMetric(row.humanP90Minutes, 'นาที')}
                </span>
              </span>
            </button>
          ))
        ) : (
          <p className="py-4 text-sm text-muted-foreground">ยังไม่มีคำตอบจากคนในช่วงนี้</p>
        )}
      </div>
      {total > 10 && (
        <div className="mt-3 flex items-center justify-between gap-2 text-sm">
          <Button variant="outline" disabled={page === 1} onClick={() => onPage(page - 1)}>
            ก่อนหน้า
          </Button>
          <span>
            {page} / {Math.ceil(total / 10)}
          </span>
          <Button variant="outline" disabled={page * 10 >= total} onClick={() => onPage(page + 1)}>
            ถัดไป
          </Button>
        </div>
      )}
    </section>
  );
}
