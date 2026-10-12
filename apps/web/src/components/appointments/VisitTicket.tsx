import { CalendarDays, MapPin } from 'lucide-react';
import type { Visit } from './types';
import { thaiDate, thaiTime } from './types';
export default function VisitTicket({ visit }: { visit: Visit }) {
  return (
    <section
      aria-label="รายละเอียดนัดหมาย"
      className="overflow-hidden rounded-2xl border border-primary/25 bg-card"
    >
      <div className="space-y-3 bg-primary/5 p-5 sm:p-6">
        <p className="flex items-center gap-2 text-sm font-medium text-primary">
          <CalendarDays aria-hidden="true" className="size-4" />
          {thaiDate(visit.startsAt)}
        </p>
        <p className="text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
          {thaiTime(visit.startsAt)} – {thaiTime(visit.endsAt)}
        </p>
        <p className="text-sm text-muted-foreground">เวลาประเทศไทย · ใช้เวลาประมาณ 45 นาที</p>
      </div>
      <div className="flex items-start gap-3 border-t border-dashed border-primary/25 p-5 sm:p-6">
        <MapPin aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">{visit.branch.name}</p>
          {visit.branch.location && (
            <p className="text-sm leading-relaxed text-muted-foreground">{visit.branch.location}</p>
          )}
          <p className="break-all pt-3 text-xs font-medium tracking-wide text-muted-foreground">
            เลขนัด {visit.reference}
          </p>
        </div>
      </div>
    </section>
  );
}
