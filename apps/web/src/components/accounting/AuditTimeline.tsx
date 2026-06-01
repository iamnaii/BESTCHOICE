import { useMemo } from 'react';
import { PenLine, CheckCircle2, Undo2, Send, XCircle } from 'lucide-react';
import { formatDateTime } from '@/utils/formatters';
import type { IcabAuditEvent } from './types';

/**
 * InternalControlActionBar — audit timeline subcomponent.
 *
 * Renders the chronological history of events for a single document
 * (CREATED → POSTED → REVERSED + reason). Used inside the action bar's
 * info pop-over and on document detail pages.
 *
 * The component is purely presentational — sorting / filtering is done
 * here, but the parent must hand it the AuditLog rows scoped to this
 * document (the central `AuditLog` table is too wide to scan client-side).
 */
export interface AuditTimelineProps {
  events: IcabAuditEvent[];
  /** Show compact (no detail / reason) variant — used in tight spaces. */
  compact?: boolean;
}

const EVENT_META: Record<
  string,
  { icon: typeof PenLine; tone: string; label: string }
> = {
  CREATED: { icon: PenLine, tone: 'text-info', label: 'สร้างเอกสาร' },
  SUBMITTED_FOR_APPROVAL: { icon: Send, tone: 'text-warning', label: 'ส่งให้อนุมัติ' },
  APPROVED: { icon: CheckCircle2, tone: 'text-success', label: 'อนุมัติ + ลงบัญชี' },
  POSTED: { icon: CheckCircle2, tone: 'text-success', label: 'อนุมัติ + ลงบัญชี' },
  REJECTED: { icon: XCircle, tone: 'text-destructive', label: 'ปฏิเสธ' },
  REVERSED: { icon: Undo2, tone: 'text-destructive', label: 'ยกเลิก / กลับรายการ' },
};

function metaFor(event: string) {
  return EVENT_META[event] ?? { icon: PenLine, tone: 'text-muted-foreground', label: event };
}

export function AuditTimeline({ events, compact = false }: AuditTimelineProps) {
  const sorted = useMemo(
    () =>
      [...events].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      ),
    [events],
  );

  if (sorted.length === 0) {
    return (
      <p className="text-xs text-muted-foreground leading-snug">
        ยังไม่มีประวัติการทำงาน
      </p>
    );
  }

  return (
    <ol className="space-y-3" aria-label="ประวัติการทำงาน">
      {sorted.map((evt, idx) => {
        const meta = metaFor(evt.event);
        const Icon = meta.icon;
        return (
          <li
            key={`${evt.event}-${evt.timestamp}-${idx}`}
            className="flex items-start gap-2.5"
            data-testid={`audit-event-${evt.event}`}
          >
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted ${meta.tone}`}
              aria-hidden
            >
              <Icon size={13} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm font-semibold leading-snug">
                  {meta.label}
                </span>
                <span className="text-xs text-muted-foreground leading-snug">
                  โดย{' '}
                  <span className="font-medium text-foreground">{evt.userName}</span>
                </span>
              </div>
              <div className="text-xs text-muted-foreground leading-snug">
                {formatDateTime(evt.timestamp)}
                {!compact && evt.detail ? ` · ${evt.detail}` : null}
              </div>
              {!compact && evt.reason ? (
                <div className="mt-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs leading-snug">
                  <span className="font-semibold text-foreground">เหตุผล: </span>
                  <span className="text-muted-foreground">{evt.reason}</span>
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
