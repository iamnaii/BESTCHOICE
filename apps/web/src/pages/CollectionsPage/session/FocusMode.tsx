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

  // Keyboard shortcuts: '3' opens skip dialog, Escape pauses.
  // Phone (1) and LINE (2) require deliberate clicks since they kick off
  // real comms with the customer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return;
      if (!current) return;
      if (e.key === '3') setShowSkip(true);
      if (e.key === 'Escape') onPause();
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
    </div>
  );
}
