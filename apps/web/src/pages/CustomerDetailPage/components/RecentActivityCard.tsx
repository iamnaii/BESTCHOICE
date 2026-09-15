import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { defaultEventStyle } from '@/components/timeline/eventTimelineStyles';
import { Card, CardContent, CardHeader, CardHeading, CardTitle, CardToolbar } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/utils/formatters';
import { isJourneyRedirect, useCustomerJourney } from '../hooks/useCustomerJourney';
import { canViewJourney, journeyEventSubtitle, OVERVIEW_GROUPS, OVERVIEW_LIMIT } from '../utils/journeyGroups';

/** การ์ดท้ายแท็บภาพรวม — 6 เหตุการณ์ล่าสุดของแชท/เครดิต/ขาย · ปุ่มพาไปแท็บการเดินทาง · ไม่อ่าน metadata (PDPA) */
export default function RecentActivityCard({
  customerId,
  role,
  onOpenJourney,
}: {
  customerId: string;
  role: string;
  onOpenJourney: () => void;
}) {
  const visible = canViewJourney(role);
  const query = useCustomerJourney(customerId, OVERVIEW_GROUPS, { limit: OVERVIEW_LIMIT, enabled: visible });
  if (!visible) return null;

  const first = query.data?.pages[0];
  const events = first && !isJourneyRedirect(first) ? first.events.slice(0, OVERVIEW_LIMIT) : [];

  return (
    <Card>
      <CardHeader>
        <CardHeading>
          <CardTitle>กิจกรรมล่าสุด</CardTitle>
        </CardHeading>
        <CardToolbar>
          <button
            type="button"
            onClick={onOpenJourney}
            className="inline-flex items-center gap-0.5 text-[13px] leading-snug text-primary hover:underline"
          >
            ดูการเดินทางทั้งหมด
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </button>
        </CardToolbar>
      </CardHeader>
      <CardContent className="pt-0">
        {query.isLoading ? (
          <div className="py-4 text-sm leading-snug text-muted-foreground">กำลังโหลดกิจกรรม…</div>
        ) : query.isError ? (
          <div className="py-4 text-sm leading-snug text-destructive">โหลดกิจกรรมไม่สำเร็จ</div>
        ) : events.length === 0 ? (
          <div className="py-4 text-sm leading-snug text-muted-foreground">ยังไม่มีกิจกรรม</div>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((event) => {
              const { Icon, iconBg, iconText, typeLabel } = defaultEventStyle(event);
              const sub = [
                formatDateTime(event.timestamp),
                journeyEventSubtitle(event),
                event.reliability === 'approximate' ? 'ประมาณ' : null,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <li key={event.id} className="flex items-start gap-3 py-2.5">
                  <span
                    title={typeLabel}
                    className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full', iconBg)}
                  >
                    <Icon className={cn('size-3.5', iconText)} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    {event.href ? (
                      <Link
                        to={event.href}
                        className="block truncate text-sm font-medium leading-snug text-foreground hover:text-primary"
                      >
                        {event.title}
                      </Link>
                    ) : (
                      <div className="truncate text-sm font-medium leading-snug text-foreground">{event.title}</div>
                    )}
                    <div className="truncate text-xs leading-snug text-muted-foreground">{sub}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
