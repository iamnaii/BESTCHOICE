import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { defaultEventStyle, type EventStyle } from './eventTimelineStyles';
import { groupEventsByDate, relativeTimeLabel } from './eventTimelineUtils';

/**
 * รูปขั้นต่ำที่ไทม์ไลน์กลางต้องการ — TimelineEvent ของแผงติดตามหนี้ และ JourneyEvent
 * (packages/shared/src/customer-journey.ts) ส่งเข้ามาได้ตรง ๆ โดยไม่ต้องแปลง
 */
export interface EventTimelineItem {
  id: string;
  type: string;
  group?: string;
  timestamp: string;
  title: string;
  subtitle?: string;
  /** 'approximate' = เวลาย้อนหลังที่ระบบประมาณจากข้อมูลอื่น → ป้าย "ประมาณ" */
  reliability?: 'exact' | 'approximate';
  /** ลิงก์ในแอป เช่น /inbox/:roomId · /contracts/:id — ไม่มี = หัวข้อไม่เป็นลิงก์ */
  href?: string;
  metadata?: Record<string, unknown>;
}

export interface EventTimelineProps<T extends EventTimelineItem> {
  events: T[];
  /** ไอคอน/สี/ป้ายชนิดต่อแถว — ไม่ส่ง = ตามกลุ่ม (defaultEventStyle) */
  getStyle?: (event: T) => EventStyle;
  /** ส่วนเสริมใต้คำอธิบาย เช่น ตัวเล่นไฟล์เสียงของการโทร — คืน null = ไม่มี */
  renderExtra?: (event: T) => ReactNode;
  emptyText?: string;
  /** แสดงท้ายรายการเมื่อมีรายการเท่านั้น เช่น ป้ายจำกัดจำนวน / ปุ่มโหลดเพิ่ม */
  footer?: ReactNode;
}

export function EventTimeline<T extends EventTimelineItem>({
  events,
  getStyle = defaultEventStyle,
  renderExtra,
  emptyText = 'ยังไม่มีกิจกรรม',
  footer,
}: EventTimelineProps<T>) {
  if (events.length === 0) {
    return <div className="text-center py-8 text-sm text-muted-foreground leading-snug">{emptyText}</div>;
  }

  const now = new Date();

  return (
    <div className="space-y-1">
      {groupEventsByDate(events, now).map((group, groupIdx) => (
        <div key={group.label} data-testid="event-timeline-group">
          <div
            className={`text-xs uppercase tracking-wider text-muted-foreground mb-1 leading-snug ${
              groupIdx === 0 ? '' : 'mt-4'
            }`}
          >
            {group.label}
          </div>

          <div>
            {group.items.map((event) => {
              const { Icon, iconBg, iconText, typeLabel } = getStyle(event);
              const extra = renderExtra ? renderExtra(event) : null;
              return (
                <div
                  key={event.id}
                  data-testid="event-timeline-item"
                  className="flex gap-3 px-1 py-2.5 rounded-lg hover:bg-muted/40 transition-colors"
                >
                  <div className={`shrink-0 mt-0.5 size-8 rounded-full flex items-center justify-center ${iconBg}`}>
                    <Icon className={`size-4 ${iconText}`} aria-hidden="true" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 text-xs text-muted-foreground mb-0.5">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="tabular-nums leading-snug">{relativeTimeLabel(event.timestamp, now.getTime())}</span>
                        {event.reliability === 'approximate' && (
                          <span
                            title="เวลาโดยประมาณ — ข้อมูลย้อนหลังระบุเวลาได้ไม่แน่นอน"
                            className="rounded-sm border border-border px-1 text-[10px] leading-snug text-muted-foreground"
                          >
                            ประมาณ
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider leading-snug shrink-0">{typeLabel}</span>
                    </div>

                    {event.href ? (
                      <Link
                        to={event.href}
                        className="block text-sm font-medium leading-snug truncate text-foreground hover:text-primary hover:underline"
                      >
                        {event.title}
                      </Link>
                    ) : (
                      <div className="text-sm font-medium leading-snug truncate">{event.title}</div>
                    )}

                    {event.subtitle && (
                      <div className="text-xs text-muted-foreground mt-0.5 truncate leading-snug">{event.subtitle}</div>
                    )}

                    {extra ? <div className="mt-1.5">{extra}</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {footer}
    </div>
  );
}
