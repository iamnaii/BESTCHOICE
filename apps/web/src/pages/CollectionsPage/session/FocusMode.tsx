import { useEffect, useMemo, useState } from 'react';
import { Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import SessionTimer from './SessionTimer';
import SessionProgress from './SessionProgress';
import FocusContractCard from './FocusContractCard';
import SkipReasonDialog from './SkipReasonDialog';
import ContactLogDialog from '../components/ContactLogDialog';
import SendLineAdHocDialog from '../components/SendLineAdHocDialog';
import Customer360Panel from '../components/Customer360Panel';
import { useSessionActions, type Outcome, type SkipReason } from '../hooks/useSessionActions';
import type { MySession, SessionContract } from '../hooks/useMySession';
import type { ContractRow } from '../types';

const DEFAULT_TARGET_MINUTES = 150;

interface Props {
  session: MySession;
  startedAt: Date;
  onPause: () => void;
}

/**
 * Maps the ContactLogDialog `outcome` (free-string CallResult or
 * structured CallResultTag) into a session AssignmentOutcome.
 *
 * The dialog passes either:
 *  - CallResult enum: NO_ANSWER | ANSWERED | PROMISED | REFUSED | WRONG_NUMBER | OTHER
 *  - CallResultTag (structured chip) — same set, plus richer values
 *
 * We default unknown values to CALL_CONNECTED since the user did go
 * through the log-result flow (i.e. they at least talked to someone).
 */
function mapOutcomeFromCallResult(callResult?: string): Outcome {
  switch (callResult) {
    case 'ANSWERED':
      return 'CALL_CONNECTED';
    case 'NO_ANSWER':
      return 'CALL_NO_ANSWER';
    case 'PROMISED':
      return 'PROMISE_MADE';
    case 'REFUSED':
      return 'REFUSED';
    default:
      return 'CALL_CONNECTED';
  }
}

export default function FocusMode({ session, startedAt, onPause }: Props) {
  const pending = useMemo(() => session.contracts, [session.contracts]);
  const total = pending.length + (session.summary?.total ?? 0);
  const currentIdx = session.summary?.total ?? 0;
  const current: SessionContract | undefined = pending[0];

  const [showSkip, setShowSkip] = useState(false);
  const [contactLogContract, setContactLogContract] = useState<ContractRow | null>(null);
  const [lineDialogContract, setLineDialogContract] = useState<ContractRow | null>(null);
  const [panelContract, setPanelContract] = useState<ContractRow | null>(null);

  const { action, skip } = useSessionActions();

  // Keyboard shortcuts: 1=โทร, 2=LINE, 3=ข้าม, 4=บันทึก, Esc=หยุดพัก.
  // We dispatch click() against rendered buttons (data-* anchors) instead
  // of duplicating handlers — keeps a single source of truth for behavior
  // (e.g. CallButton owns its disabled / loading / phone-missing logic).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept while user is typing in any text field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Don't intercept while a Radix dialog/select is open (heuristic)
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (!current) return;

      switch (e.key) {
        case '1': {
          const btn = document.querySelector<HTMLElement>(
            '[data-call-button] button, [data-call-button]',
          );
          btn?.click();
          e.preventDefault();
          break;
        }
        case '2': {
          const btn = document.querySelector<HTMLButtonElement>('[data-line-button]');
          if (btn && !btn.disabled) btn.click();
          e.preventDefault();
          break;
        }
        case '3':
          setShowSkip(true);
          e.preventDefault();
          break;
        case '4': {
          const btn = document.querySelector<HTMLElement>('[data-log-button]');
          btn?.click();
          e.preventDefault();
          break;
        }
        case 'Escape':
          onPause();
          e.preventDefault();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, onPause]);

  if (!current) {
    return null;
  }

  const handleLogContactClick = () => {
    setContactLogContract(current.contract as unknown as ContractRow);
  };

  const handleSendLineClick = () => {
    setLineDialogContract(current.contract as unknown as ContractRow);
  };

  const handleOpen360 = () => {
    setPanelContract(current.contract as unknown as ContractRow);
  };

  const handleSkipSubmit = (reason: SkipReason, note?: string) => {
    skip.mutate(
      { assignmentId: current.id, reason, note },
      {
        onSuccess: () => toast.success('ข้ามรายการแล้ว'),
        onError: () => toast.error('ไม่สามารถข้ามได้'),
      },
    );
  };

  return (
    <div className="space-y-3 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3 px-1">
        <SessionProgress current={currentIdx} total={total} />
        <div className="flex items-center gap-3">
          <SessionTimer startedAt={startedAt} targetMinutes={DEFAULT_TARGET_MINUTES} />
          <Button variant="ghost" size="sm" onClick={onPause}>
            <Pause className="size-4 mr-1.5" /> หยุดพัก
          </Button>
        </div>
      </div>

      <FocusContractCard
        assignment={current}
        onCallEnded={() => {}}
        onLogContact={handleLogContactClick}
        onSendLine={handleSendLineClick}
        onSkip={() => setShowSkip(true)}
        onOpen360={handleOpen360}
      />

      <SkipReasonDialog
        open={showSkip}
        onOpenChange={setShowSkip}
        onSubmit={handleSkipSubmit}
      />

      <ContactLogDialog
        open={!!contactLogContract}
        contract={contactLogContract}
        onClose={() => setContactLogContract(null)}
        onSaved={(result) => {
          action.mutate(
            {
              assignmentId: current.id,
              outcome: mapOutcomeFromCallResult(result?.outcome),
              notes: result?.notes,
            },
            { onSuccess: () => toast.success('บันทึกผลและไปต่อ') },
          );
          setContactLogContract(null);
        }}
      />

      <SendLineAdHocDialog
        open={!!lineDialogContract}
        contract={lineDialogContract}
        onClose={() => setLineDialogContract(null)}
        onSent={(messageId) => {
          action.mutate(
            {
              assignmentId: current.id,
              outcome: 'LINE_SENT',
              lineMessageId: messageId,
            },
            { onSuccess: () => toast.success('ส่ง LINE แล้ว') },
          );
          setLineDialogContract(null);
        }}
      />

      <Customer360Panel
        contract={panelContract}
        onClose={() => setPanelContract(null)}
        onRequestSendLine={(c) => setLineDialogContract(c as ContractRow)}
      />

      <div className="hidden sm:flex items-center justify-center gap-3 text-2xs text-muted-foreground/60 leading-snug pt-2">
        <span className="inline-flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border border-border/60 font-mono text-[10px]">
            1
          </kbd>{' '}
          โทร
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border border-border/60 font-mono text-[10px]">
            2
          </kbd>{' '}
          LINE
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border border-border/60 font-mono text-[10px]">
            3
          </kbd>{' '}
          ข้าม
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border border-border/60 font-mono text-[10px]">
            4
          </kbd>{' '}
          บันทึก
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border border-border/60 font-mono text-[10px]">
            Esc
          </kbd>{' '}
          หยุดพัก
        </span>
      </div>
    </div>
  );
}
