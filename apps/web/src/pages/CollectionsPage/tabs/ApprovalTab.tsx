import { ShieldAlert, Lock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  usePendingEscalations,
  usePendingMdm,
  useApproveEscalation,
  useRejectEscalation,
  useApproveMdm,
  useRejectMdm,
} from '../hooks/useApprovalQueues';
import { EscalationRow, MdmRow } from '../components/ApprovalPendingRow';
import LetterQueueSection from '../components/LetterQueueSection';
import LineRetryQueueSection from '../components/LineRetryQueueSection';
import LateFeeWaiverApprovalSection from '../components/LateFeeWaiverApprovalRow';

function RowSkeleton() {
  return <div className="bg-muted animate-pulse h-20 rounded-lg" />;
}

export default function ApprovalTab() {
  const escalations = usePendingEscalations();
  const mdm = usePendingMdm();

  const approveEscalation = useApproveEscalation();
  const rejectEscalation = useRejectEscalation();
  const approveMdm = useApproveMdm();
  const rejectMdm = useRejectMdm();

  return (
    <div className="space-y-6">
      {/* Dunning escalations queue */}
      <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-warning" />
              <h3 className="text-sm font-semibold leading-snug">รออนุมัติเลื่อนระดับเตือน</h3>
            </div>
            <span className="text-xs tabular-nums bg-muted text-muted-foreground rounded-full px-2 py-0.5">
              {escalations.data?.length ?? 0}
            </span>
          </div>

          {escalations.isLoading ? (
            <div className="space-y-2">
              <RowSkeleton />
              <RowSkeleton />
            </div>
          ) : !escalations.data || escalations.data.length === 0 ? (
            <div className="rounded-lg border border-dashed border-success/30 bg-success/5 py-8 text-center">
              <div className="text-sm font-medium text-success leading-snug">
                ไม่มีรายการรออนุมัติ
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {escalations.data.map((item) => (
                <EscalationRow
                  key={item.id}
                  item={item}
                  onApprove={(contractId) => approveEscalation.mutate(contractId)}
                  onReject={(contractId, reason) =>
                    rejectEscalation.mutate({ contractId, reason })
                  }
                  approvePending={approveEscalation.isPending}
                  rejectPending={rejectEscalation.isPending}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* MDM lock queue */}
      <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Lock className="size-4 text-destructive" />
              <h3 className="text-sm font-semibold leading-snug">รออนุมัติล็อคเครื่อง</h3>
            </div>
            <span className="text-xs tabular-nums bg-muted text-muted-foreground rounded-full px-2 py-0.5">
              {mdm.data?.length ?? 0}
            </span>
          </div>

          {mdm.isLoading ? (
            <div className="space-y-2">
              <RowSkeleton />
              <RowSkeleton />
            </div>
          ) : !mdm.data || mdm.data.length === 0 ? (
            <div className="rounded-lg border border-dashed border-success/30 bg-success/5 py-8 text-center">
              <div className="text-sm font-medium text-success leading-snug">
                ไม่มีรายการรออนุมัติ
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {mdm.data.map((item) => (
                <MdmRow
                  key={item.id}
                  item={item}
                  onApprove={(requestId, opts) =>
                    approveMdm.mutate({ id: requestId, includeWallpaper: opts?.includeWallpaper })
                  }
                  onReject={(requestId, reason) => rejectMdm.mutate({ requestId, reason })}
                  approvePending={approveMdm.isPending}
                  rejectPending={rejectMdm.isPending}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Late fee waiver requests — collector → OWNER 4-eyes flow */}
      <LateFeeWaiverApprovalSection />

      {/* Letter queue — generate PDF → dispatch → track delivery */}
      <LetterQueueSection />

      {/* LINE/SMS retry queue — failed DunningActions */}
      <LineRetryQueueSection />
    </div>
  );
}
