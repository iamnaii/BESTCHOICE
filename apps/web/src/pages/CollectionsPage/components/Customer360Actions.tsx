import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banknote, MessageSquare, Lock, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PaymentRecordDialog from './PaymentRecordDialog';
import type { ContractRow } from '../types';

interface Props {
  contract: ContractRow;
  onSendLine?: () => void; // wired in Task 8
  onProposeLock?: () => void; // optional — parent may override with its own modal flow
}

export default function Customer360Actions({ contract, onSendLine, onProposeLock }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [lockReason, setLockReason] = useState('');

  // Inline propose-lock mutation (used when caller doesn't provide onProposeLock).
  // Uses a local modal (matches BulkActionBar's InlineLockModal pattern) — no window.prompt().
  const proposeMutation = useMutation({
    mutationFn: async (reason: string) => {
      const { data } = await api.post('/overdue/bulk/propose-lock', {
        contractIds: [contract.id],
        reason: reason.trim(),
      });
      return data;
    },
    onSuccess: () => {
      toast.success('เสนอล็อคเครื่องแล้ว รออนุมัติจาก OWNER');
      qc.invalidateQueries({ queryKey: ['pending-mdm'] });
      qc.invalidateQueries({ queryKey: ['customer-360', contract.id] });
      setLockOpen(false);
      setLockReason('');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const handleProposeLock = onProposeLock ?? (() => setLockOpen(true));

  const canRecordPayment = contract.outstanding > 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setPaymentOpen(true)}
          disabled={!canRecordPayment}
          className="flex flex-col items-center gap-1.5 py-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Banknote className="size-5" />
          <span className="text-xs font-medium leading-snug">บันทึกจ่าย</span>
        </button>

        <button
          onClick={onSendLine}
          disabled={!contract.customer.lineId || !onSendLine}
          className="flex flex-col items-center gap-1.5 py-3 rounded-lg border border-input hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={!contract.customer.lineId ? 'ลูกค้าไม่มี LINE ID' : undefined}
        >
          <MessageSquare className="size-5" />
          <span className="text-xs font-medium leading-snug">ส่ง LINE</span>
        </button>

        <button
          onClick={handleProposeLock}
          disabled={contract.deviceLocked || proposeMutation.isPending}
          className="flex flex-col items-center gap-1.5 py-3 rounded-lg border border-input hover:bg-muted disabled:opacity-50 transition-colors"
          title={contract.deviceLocked ? 'ล็อคเครื่องแล้ว' : 'เสนอล็อคเครื่อง'}
        >
          <Lock className="size-5" />
          <span className="text-xs font-medium leading-snug">
            {contract.deviceLocked ? 'ล็อคแล้ว' : proposeMutation.isPending ? 'กำลังเสนอ...' : 'เสนอล็อค'}
          </span>
        </button>

        <button
          onClick={() => navigate(`/contracts/${contract.id}`)}
          className="flex flex-col items-center gap-1.5 py-3 rounded-lg border border-input hover:bg-muted transition-colors"
        >
          <ExternalLink className="size-5" />
          <span className="text-xs font-medium leading-snug">ดูสัญญาเต็ม</span>
        </button>
      </div>

      <PaymentRecordDialog
        open={paymentOpen}
        contract={contract}
        onClose={() => setPaymentOpen(false)}
      />

      {lockOpen && (
        <InlineLockModal
          value={lockReason}
          onChange={setLockReason}
          pending={proposeMutation.isPending}
          onClose={() => {
            setLockOpen(false);
            setLockReason('');
          }}
          onSubmit={() => proposeMutation.mutate(lockReason)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// InlineLockModal — mirrors the pattern in BulkActionBar so the UX is identical
// between bulk action bar and Customer 360 actions. No window.prompt().
// ---------------------------------------------------------------------------

function InlineLockModal({
  value,
  onChange,
  pending,
  onClose,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const valid = value.trim().length >= 5;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
      <div
        className="relative bg-card rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5 border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold mb-1 leading-snug">เสนอล็อคเครื่อง</div>
        <div className="text-xs text-muted-foreground mb-3 leading-snug">
          เหตุผลจะบันทึกใน audit log และ OWNER จะเห็นในแท็บ &quot;อนุมัติ&quot;
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder="เช่น ลูกค้าติดต่อไม่ได้ 4 วัน โทรไป 5 ครั้งไม่รับ..."
          className="w-full px-3 py-2 border border-input rounded-lg text-sm mb-2 resize-none leading-snug"
          autoFocus
        />
        <div className="text-xs text-muted-foreground mb-4 leading-snug">
          {value.length} ตัวอักษร (ขั้นต่ำ 5)
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg border border-input hover:bg-muted transition-colors"
          >
            ยกเลิก
          </button>
          <button
            onClick={onSubmit}
            disabled={!valid || pending}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
          >
            {pending ? 'กำลังเสนอ...' : 'เสนอล็อค'}
          </button>
        </div>
      </div>
    </div>
  );
}
