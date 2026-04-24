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
  onProposeLock?: () => void; // optional inline fallback if Task 7 caller doesn't override
}

export default function Customer360Actions({ contract, onSendLine, onProposeLock }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [paymentOpen, setPaymentOpen] = useState(false);

  // Inline propose-lock mutation (used when caller doesn't provide onProposeLock)
  const proposeMutation = useMutation({
    mutationFn: async () => {
      const reason = window.prompt('ระบุเหตุผลการเสนอล็อคเครื่อง (≥ 5 ตัวอักษร):');
      if (!reason || reason.trim().length < 5) {
        throw new Error('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');
      }
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
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const handleProposeLock = onProposeLock ?? (() => proposeMutation.mutate());

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
    </>
  );
}
