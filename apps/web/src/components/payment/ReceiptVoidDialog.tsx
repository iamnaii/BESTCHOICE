import { useQueryClient } from '@tanstack/react-query';
import PaymentApprovalRequestDialog from '@/components/payment/PaymentApprovalRequestDialog';

interface Props {
  receiptId: string | null;
  receiptNumber?: string;
  onClose: () => void;
  /** Kept for existing callers. A pending request does not fire a void callback. */
  onVoided?: () => void;
}

export default function ReceiptVoidDialog({ receiptId, receiptNumber, onClose }: Props) {
  const queryClient = useQueryClient();
  return (
    <PaymentApprovalRequestDialog
      open={!!receiptId}
      onOpenChange={(open) => { if (!open) onClose(); }}
      action="VOID_RECEIPT"
      targetId={receiptId ?? ''}
      payload={{}}
      description={`ขอยกเลิกใบเสร็จ${receiptNumber ? ` ${receiptNumber}` : ''} เมื่ออนุมัติ ระบบจะสร้างใบลดหนี้และยกเลิกใบเสร็จอื่นของงวดเดียวกันด้วย`}
      onRequested={() => {
        queryClient.invalidateQueries({ queryKey: ['payment-approval-requests'] });
      }}
    />
  );
}
