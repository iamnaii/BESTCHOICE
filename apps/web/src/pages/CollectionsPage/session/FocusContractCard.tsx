import { useState } from 'react';
import {
  MessageSquare,
  SkipForward,
  ChevronDown,
  AlertTriangle,
  PhoneMissed,
  NotebookPen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/utils/formatters';
import { CallButton } from '@/components/CallButton';
import type { SessionContract } from '../hooks/useMySession';

interface Props {
  assignment: SessionContract;
  /** Reserved — CallButton has no native onEnd callback. Currently unused but
   *  kept on the interface so FocusMode can wire it once the softphone exposes
   *  a hangup signal. */
  onCallEnded: () => void;
  onLogContact: () => void;
  onSendLine: () => void;
  onSkip: () => void;
  onOpen360: () => void;
}

function severityPanel(daysOverdue: number): { bg: string; fg: string; label: string } {
  if (daysOverdue >= 90)
    return { bg: 'bg-destructive', fg: 'text-destructive-foreground', label: 'ค้างนานมาก' };
  if (daysOverdue >= 30)
    return { bg: 'bg-destructive/85', fg: 'text-destructive-foreground', label: 'ค้างนาน' };
  if (daysOverdue >= 8)
    return { bg: 'bg-warning', fg: 'text-warning-foreground', label: 'ค้างปานกลาง' };
  if (daysOverdue >= 1)
    return { bg: 'bg-primary', fg: 'text-primary-foreground', label: 'ค้างไม่นาน' };
  return { bg: 'bg-muted', fg: 'text-muted-foreground', label: 'ปกติ' };
}

export default function FocusContractCard({
  assignment,
  onCallEnded,
  onLogContact,
  onSendLine,
  onSkip,
  onOpen360,
  onCallEnded: _onCallEnded,
}: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const c = assignment.contract;
  const sev = severityPanel(c.daysOverdue);

  return (
    <div className="rounded-2xl border border-border/50 bg-card shadow-sm overflow-hidden">
      {/* Severity header band */}
      <div className={`${sev.bg} ${sev.fg} px-6 py-4 flex items-center justify-between`}>
        <div className="flex items-baseline gap-3">
          <span className="text-3xl sm:text-4xl font-bold tabular-nums leading-none tracking-tight">
            {c.daysOverdue}
          </span>
          <span className="text-base font-semibold leading-snug opacity-95">วัน</span>
          <span className="text-sm leading-snug opacity-80 hidden sm:inline">
            — {sev.label}
          </span>
        </div>
        {assignment.escalationFlag && (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium leading-snug">
            <AlertTriangle className="size-4" />
            ต้องดูเป็นพิเศษ
          </span>
        )}
      </div>

      <div className="px-6 sm:px-8 py-6">
        {/* Customer name — the hero */}
        <div className="text-2xl sm:text-3xl font-bold leading-snug mb-1">{c.customer.name}</div>

        {/* Contract # + branch */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground leading-snug mb-5">
          <span className="font-mono">{c.contractNumber}</span>
          <span className="text-border">·</span>
          <span>{c.branch.name}</span>
        </div>

        {/* Outstanding + phone — stacked rows, large readable */}
        <div className="space-y-3 mb-5">
          {c.outstanding != null && (
            <div className="flex items-baseline justify-between gap-3 pb-3 border-b border-border/40">
              <span className="text-base text-muted-foreground leading-snug">ค้างชำระ</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl sm:text-4xl font-bold tabular-nums text-destructive leading-none tracking-tight">
                  {formatNumber(c.outstanding)}
                </span>
                <span className="text-base font-semibold text-destructive leading-snug">฿</span>
              </div>
            </div>
          )}

          {c.customer.phone && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-base text-muted-foreground leading-snug">เบอร์โทร</span>
              <span className="font-mono tabular-nums text-xl font-semibold text-foreground leading-snug">
                {c.customer.phone}
              </span>
            </div>
          )}
        </div>

        {/* Risk indicators */}
        {((c.brokenPromiseCount ?? 0) > 0 || (c.noAnswerCount ?? 0) > 0) && (
          <div className="flex flex-wrap gap-2 mb-5">
            {(c.brokenPromiseCount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 text-destructive text-sm font-medium px-3 py-1.5 leading-snug">
                <AlertTriangle className="size-4" />
                เคยผิดนัด {c.brokenPromiseCount} ครั้ง
              </span>
            )}
            {(c.noAnswerCount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 text-warning border border-warning/20 text-sm font-medium px-3 py-1.5 leading-snug">
                <PhoneMissed className="size-4" />
                ไม่รับสาย {c.noAnswerCount} ครั้ง
              </span>
            )}
          </div>
        )}

        {/* Action buttons — 2x2 grid, big icons + clear Thai labels */}
        <div className="grid grid-cols-2 gap-2.5">
          <div data-call-button className="contents">
            <CallButton
              customerId={c.customer.id}
              contractId={c.id}
              phone={c.customer.phone ?? undefined}
              size="md"
              variant="primary"
              className="h-16 text-base font-semibold w-full justify-center"
            />
          </div>
          <Button
            variant="outline"
            className="h-16 text-base font-semibold gap-2"
            onClick={onLogContact}
            data-log-button
          >
            <NotebookPen className="size-5" />
            บันทึกผล
          </Button>
          <Button
            variant="outline"
            className="h-16 text-base font-semibold gap-2"
            disabled={!c.customer.lineId}
            onClick={onSendLine}
            data-line-button
          >
            <MessageSquare className="size-5" />
            ส่ง LINE
          </Button>
          <Button
            variant="outline"
            className="h-16 text-base font-semibold gap-2"
            onClick={onSkip}
            data-skip-button
          >
            <SkipForward className="size-5" />
            ข้ามรายนี้
          </Button>
        </div>

        {/* Details toggle */}
        <button
          type="button"
          onClick={() => {
            setShowDetails((v) => !v);
            if (!showDetails) onOpen360();
          }}
          className="w-full mt-5 flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
        >
          <ChevronDown
            className={`size-4 transition-transform ${showDetails ? 'rotate-180' : ''}`}
          />
          {showDetails ? 'ซ่อนข้อมูลลูกค้า' : 'ดูข้อมูลลูกค้าทั้งหมด'}
        </button>
      </div>
    </div>
  );
}
