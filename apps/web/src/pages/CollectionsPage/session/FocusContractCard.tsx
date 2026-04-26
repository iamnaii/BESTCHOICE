import { useState } from 'react';
import {
  MessageSquare,
  SkipForward,
  ChevronDown,
  AlertTriangle,
  PhoneMissed,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/utils/formatters';
import { CallButton } from '@/components/CallButton';
import type { SessionContract } from '../hooks/useMySession';

interface Props {
  assignment: SessionContract;
  /**
   * Fired when the user signals they are done with this contract's call.
   * CallButton itself doesn't emit a lifecycle event, so the parent should
   * also listen to call-ended signals (webhook / contact-log mutation) to
   * advance the session. Reserved here for future wiring.
   */
  onCallEnded: () => void;
  onSendLine: () => void;
  onSkip: () => void;
  onOpen360: () => void;
}

function severityPanel(daysOverdue: number): { bg: string; fg: string; label: string } {
  if (daysOverdue >= 90)
    return { bg: 'bg-destructive', fg: 'text-destructive-foreground', label: '90+ วัน' };
  if (daysOverdue >= 30)
    return { bg: 'bg-destructive/85', fg: 'text-destructive-foreground', label: '30-89 วัน' };
  if (daysOverdue >= 8)
    return { bg: 'bg-warning', fg: 'text-warning-foreground', label: '8-29 วัน' };
  if (daysOverdue >= 1)
    return { bg: 'bg-primary', fg: 'text-primary-foreground', label: '1-7 วัน' };
  return { bg: 'bg-muted', fg: 'text-muted-foreground', label: '0 วัน' };
}

export default function FocusContractCard({
  assignment,
  onCallEnded: _onCallEnded,
  onSendLine,
  onSkip,
  onOpen360,
}: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const c = assignment.contract;
  const sev = severityPanel(c.daysOverdue);

  // Reference the prop to avoid unused-var lint while parent wires
  // call-ended detection separately (CallButton has no onComplete callback).
  void _onCallEnded;

  return (
    <div className="rounded-2xl border border-border/50 bg-card shadow-sm overflow-hidden">
      <div className={`${sev.bg} ${sev.fg} px-5 py-4 flex items-baseline justify-between`}>
        <div>
          <div className="text-2xs uppercase tracking-wider opacity-80 leading-snug">
            ความเร่งด่วน
          </div>
          <div className="font-mono text-2xl font-bold tabular-nums tracking-tight leading-snug mt-0.5">
            {sev.label}
          </div>
        </div>
        {assignment.escalationFlag && (
          <span className="inline-flex items-center gap-1 text-2xs font-medium opacity-90 leading-snug">
            <AlertTriangle className="size-3.5" /> Escalation
          </span>
        )}
      </div>

      <div className="px-5 sm:px-6 py-5">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <div className="font-mono text-xs text-primary font-medium leading-snug">
            {c.contractNumber}
          </div>
          <div className="text-2xs text-muted-foreground leading-snug">{c.branch.name}</div>
        </div>

        <div className="text-xl sm:text-2xl font-bold leading-snug truncate">
          {c.customer.name}
        </div>

        {c.customer.phone && (
          <div className="font-mono tabular-nums text-base text-muted-foreground tracking-tight mt-1 leading-snug">
            {c.customer.phone}
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-border/40 flex items-baseline gap-4 flex-wrap">
          {c.outstanding != null && (
            <div>
              <div className="text-2xs uppercase tracking-wider text-muted-foreground/80 leading-snug">
                ค้างชำระ
              </div>
              <div className="font-mono text-2xl font-bold tabular-nums text-destructive tracking-tight leading-snug mt-0.5">
                {formatNumber(c.outstanding)} <span className="text-base font-medium">฿</span>
              </div>
            </div>
          )}

          {(c.brokenPromiseCount ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 text-destructive text-2xs font-medium px-2 py-0.5 leading-snug">
              <AlertTriangle className="size-3" />
              นัดผิด {c.brokenPromiseCount}
            </span>
          )}
          {(c.noAnswerCount ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 text-warning border border-warning/20 text-2xs font-medium px-2 py-0.5 leading-snug">
              <PhoneMissed className="size-3" />
              ไม่รับ {c.noAnswerCount}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 mt-6">
          <CallButton
            customerId={c.customer.id}
            contractId={c.id}
            phone={c.customer.phone ?? undefined}
            variant="primary"
            size="md"
            className="h-14 text-base w-full justify-center"
          />
          <Button
            variant="outline"
            size="lg"
            className="h-14 text-base flex-col gap-0.5"
            disabled={!c.customer.lineId}
            onClick={onSendLine}
          >
            <MessageSquare className="size-5" />
            <span className="text-xs leading-none">LINE</span>
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-14 text-base flex-col gap-0.5"
            onClick={onSkip}
          >
            <SkipForward className="size-5" />
            <span className="text-xs leading-none">ข้าม</span>
          </Button>
        </div>

        <button
          type="button"
          onClick={() => {
            setShowDetails((v) => !v);
            if (!showDetails) onOpen360();
          }}
          className="w-full mt-4 flex items-center justify-center gap-1.5 text-2xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown
            className={`size-3 transition-transform ${showDetails ? 'rotate-180' : ''}`}
          />
          {showDetails ? 'ซ่อนข้อมูลลูกค้า' : 'ดูข้อมูลลูกค้า'}
        </button>
      </div>
    </div>
  );
}
