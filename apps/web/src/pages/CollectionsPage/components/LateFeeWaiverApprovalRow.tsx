import { useState } from 'react';
import { CheckCircle, XCircle, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import {
  useLateFeeWaivers,
  useApproveLateFeeWaiver,
  useRejectLateFeeWaiver,
  type LateFeeWaiverRequest,
} from '../hooks/useLateFeeWaiver';

function daysSince(iso: string): number {
  const diff = Date.now() - new Date(iso).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function staleLabel(iso: string): string {
  const d = daysSince(iso);
  if (d === 0) return 'วันนี้';
  if (d === 1) return 'เมื่อวาน';
  return `${d} วันที่แล้ว`;
}

function heatStrip(iso: string): string {
  const d = daysSince(iso);
  if (d >= 2) return 'bg-destructive';
  if (d >= 1) return 'bg-warning';
  return 'bg-primary';
}

interface RejectDialogProps {
  open: boolean;
  pending: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

function RejectDialog({ open, pending, onConfirm, onCancel }: RejectDialogProps) {
  const [reason, setReason] = useState('');
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-xl p-6 mx-4">
        <h3 className="text-sm font-semibold mb-3 leading-snug">ระบุเหตุผลการปฏิเสธ</h3>
        <textarea
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring leading-snug"
          rows={3}
          placeholder="เหตุผลอย่างน้อย 5 ตัวอักษร..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
        <div className="flex gap-2 mt-3 justify-end">
          <button
            onClick={onCancel}
            className="rounded-lg border border-input px-4 py-1.5 text-sm hover:bg-muted transition-colors"
          >
            ยกเลิก
          </button>
          <button
            disabled={reason.trim().length < 5 || pending}
            onClick={() => onConfirm(reason.trim())}
            className="rounded-lg bg-destructive px-4 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
          >
            {pending ? 'กำลังส่ง...' : 'ยืนยันปฏิเสธ'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  item: LateFeeWaiverRequest;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  approvePending: boolean;
  rejectPending: boolean;
}

function WaiverRow({ item, onApprove, onReject, approvePending, rejectPending }: RowProps) {
  const [showReject, setShowReject] = useState(false);
  const total = Number(item.totalWaiveAmount);

  return (
    <>
      <div className="relative flex rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className={cn('w-1 shrink-0', heatStrip(item.createdAt))} />
        <div className="flex-1 p-4 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <div className="min-w-0">
              <span className="inline-flex items-center rounded-full text-2xs font-semibold px-2 py-0.5 leading-snug mb-1 bg-warning/10 text-warning">
                ขอ waive ค่าปรับ {total.toLocaleString()} ฿
              </span>
              <div className="font-mono text-xs text-primary font-medium">
                {item.contract.contractNumber}
              </div>
              <div className="text-sm font-semibold leading-snug truncate">
                {item.contract.customer.name}
              </div>
            </div>
            <div className="text-right shrink-0 text-2xs text-muted-foreground leading-snug whitespace-nowrap">
              {staleLabel(item.createdAt)}
            </div>
          </div>

          <div className="text-2xs text-muted-foreground leading-snug mb-1 line-clamp-2">
            {item.reason}
          </div>
          <div className="text-2xs text-muted-foreground leading-snug mb-3">
            ขอโดย <span className="font-medium text-foreground">{item.requester.name}</span>
            {' · '}
            {item.contract.branch.name}
            {' · '}
            {item.paymentIds.length} งวด
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setShowReject(true)}
              disabled={rejectPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
            >
              <XCircle className="size-3.5" /> ปฏิเสธ
            </button>
            <button
              onClick={() => onApprove(item.id)}
              disabled={approvePending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <CheckCircle className="size-3.5" /> อนุมัติ
            </button>
          </div>
        </div>
      </div>

      <RejectDialog
        open={showReject}
        pending={rejectPending}
        onCancel={() => setShowReject(false)}
        onConfirm={(reason) => {
          onReject(item.id, reason);
          setShowReject(false);
        }}
      />
    </>
  );
}

function RowSkeleton() {
  return <div className="bg-muted animate-pulse h-20 rounded-lg" />;
}

/**
 * Section embedded in ApprovalTab — surfaces PENDING late-fee waiver
 * requests with approve/reject actions. Mirrors the EscalationRow /
 * MdmRow conventions so the OWNER's approval queue feels uniform.
 */
export default function LateFeeWaiverApprovalSection() {
  const waivers = useLateFeeWaivers('PENDING');
  const approve = useApproveLateFeeWaiver();
  const reject = useRejectLateFeeWaiver();

  return (
    <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Receipt className="size-4 text-warning" />
            <h3 className="text-sm font-semibold leading-snug">รออนุมัติ waive ค่าปรับ</h3>
          </div>
          <span className="text-xs tabular-nums bg-muted text-muted-foreground rounded-full px-2 py-0.5">
            {waivers.data?.length ?? 0}
          </span>
        </div>

        {waivers.isLoading ? (
          <div className="space-y-2">
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : !waivers.data || waivers.data.length === 0 ? (
          <div className="rounded-lg border border-dashed border-success/30 bg-success/5 py-8 text-center">
            <div className="text-sm font-medium text-success leading-snug">
              ไม่มีคำขอรออนุมัติ
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {waivers.data.map((item) => (
              <WaiverRow
                key={item.id}
                item={item}
                onApprove={(id) => approve.mutate(id)}
                onReject={(id, reason) => reject.mutate({ id, reason })}
                approvePending={approve.isPending}
                rejectPending={reject.isPending}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
