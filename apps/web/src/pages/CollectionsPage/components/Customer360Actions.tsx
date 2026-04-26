import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Banknote, MessageSquare, Lock, LockOpen, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/api';
import PaymentRecordDialog from './PaymentRecordDialog';
import LockDeviceDialog from './LockDeviceDialog';
import { useUnlockContract } from '../hooks/useMdmLock';
import type { ContractRow } from '../types';

interface Props {
  contract: ContractRow;
  onSendLine?: () => void;
}

export default function Customer360Actions({ contract, onSendLine }: Props) {
  const navigate = useNavigate();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const unlock = useUnlockContract();

  const canRecordPayment = contract.outstanding > 0;
  const isLocked = contract.deviceLocked || contract.mdmState === 'LOCKED';

  const handleUnlock = () => {
    if (!confirm(`ปลดล็อคเครื่องของ ${contract.customer.name}?`)) return;
    unlock.mutate(contract.id, {
      onSuccess: () => toast.success('ปลดล็อคเครื่องแล้ว'),
      onError: (e) => toast.error(getErrorMessage(e)),
    });
  };

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

        {isLocked ? (
          <button
            onClick={handleUnlock}
            disabled={unlock.isPending}
            className="flex flex-col items-center gap-1.5 py-3 rounded-lg border border-input hover:bg-muted disabled:opacity-50 transition-colors"
            title="ปลดล็อคเครื่องลูกค้า"
          >
            <LockOpen className="size-5 text-success" />
            <span className="text-xs font-medium leading-snug text-success">
              {unlock.isPending ? 'กำลังปลดล็อค...' : 'ปลดล็อค'}
            </span>
          </button>
        ) : (
          <button
            onClick={() => setLockOpen(true)}
            className="flex flex-col items-center gap-1.5 py-3 rounded-lg border border-destructive/30 hover:bg-destructive/5 transition-colors"
            title="ล็อคเครื่องลูกค้า — เปิดโหมดสูญหาย"
          >
            <Lock className="size-5 text-destructive" />
            <span className="text-xs font-medium leading-snug text-destructive">ล็อคเครื่อง</span>
          </button>
        )}

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

      <LockDeviceDialog
        open={lockOpen}
        onOpenChange={setLockOpen}
        contractId={contract.id}
        customerName={contract.customer.name}
        daysOverdue={contract.daysOverdue}
      />
    </>
  );
}
