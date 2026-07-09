import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { invalidatePaymentQueries } from '@/pages/PaymentsPage/invalidatePaymentQueries';

interface Props {
  receiptId: string | null;
  receiptNumber?: string;
  onClose: () => void;
  /** Fires after a successful void, BEFORE onClose — parents use it to re-open
   *  the record wizard on the now-unpaid installment (mockup §11.1). */
  onVoided?: () => void;
}

interface ApproverRow {
  id: string;
  name: string;
  role: string;
}

export default function ReceiptVoidDialog({ receiptId, receiptNumber, onClose, onVoided }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [approvedById, setApprovedById] = useState('');

  // SoD (ปพพ.386 W-3): the void needs an independent approver — a different
  // user from the requester. /users/approvers is the lean PII-free lookup
  // accessible to every role that can void (OWNER / ACC / BM / FM).
  const {
    data: approverData = [],
    isLoading: approversLoading,
    isError: approversError,
    refetch: refetchApprovers,
  } = useQuery<ApproverRow[]>({
    queryKey: ['void-approvers'],
    queryFn: async () => {
      const { data } = await api.get('/users/approvers');
      return data ?? [];
    },
    enabled: !!receiptId,
    staleTime: 60_000,
  });
  const approvers = approverData.filter((a) => a.id !== user?.id);

  const resetForm = () => {
    setReason('');
    setApprovedById('');
  };

  // The parents close this dialog by flipping the controlled prop
  // (setVoidTarget(null)) — Radix fires onOpenChange only for
  // internally-initiated closes (Esc / overlay / X), so state must also
  // reset when the target receipt changes or the form from a previous
  // receipt survives into the next void.
  useEffect(() => {
    setReason('');
    setApprovedById('');
  }, [receiptId]);

  const voidMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/receipts/${id}/void`, { reason, approvedById });
      return data;
    },
    onSuccess: () => {
      toast.success('ยกเลิกใบเสร็จสำเร็จ — สร้างใบลดหนี้แล้ว และงวดกลับเป็นสถานะค้างชำระ/รอชำระ');
      // Void un-pays the installment server-side — the pending queue, the
      // ชำระครบ tab, the KPI tiles and the JE panel all change, not just the
      // receipt lists. Reuse the shared post-payment invalidation set.
      invalidatePaymentQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['pending-summary'] });
      resetForm();
      onVoided?.(); // before onClose — parents read their void-target state here
      onClose();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog
      open={!!receiptId}
      onOpenChange={(open) => {
        if (!open) {
          resetForm();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ยกเลิกใบเสร็จ</DialogTitle>
          <DialogDescription>
            ระบบจะสร้างใบลดหนี้ (Credit Note) อ้างอิงใบเสร็จ
            {receiptNumber ? <span className="font-mono"> {receiptNumber}</span> : ''}{' '}
            และงวดนั้นจะกลับเป็นสถานะค้างชำระ/รอชำระ
            (ใบเสร็จอื่นของงวดเดียวกันจะถูกยกเลิกพร้อมกัน)
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground leading-snug">
              เหตุผลที่ยกเลิก <span className="text-destructive">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น ลูกค้าโอนผิดบัญชี, บันทึกผิด..."
              rows={3}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="void-approver" className="text-sm font-medium text-foreground leading-snug">
              ผู้อนุมัติการยกเลิก <span className="text-destructive">*</span>
            </label>
            <select
              id="void-approver"
              value={approvedById}
              onChange={(e) => setApprovedById(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
            >
              <option value="">— เลือกผู้อนุมัติ —</option>
              {approvers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.role})
                </option>
              ))}
            </select>
            {approversLoading ? (
              <p className="text-xs text-muted-foreground leading-snug">กำลังโหลดรายชื่อผู้อนุมัติ...</p>
            ) : approversError ? (
              <p className="text-xs text-destructive leading-snug">
                โหลดรายชื่อผู้อนุมัติไม่สำเร็จ{' '}
                <button type="button" onClick={() => refetchApprovers()} className="underline">
                  ลองใหม่
                </button>
              </p>
            ) : approvers.length === 0 ? (
              <p className="text-xs text-destructive leading-snug">
                ไม่มีผู้อนุมัติที่ใช้ได้ — ต้องมีเจ้าของ / ฝ่ายบัญชี / ผจก.สาขา / ผจก.การเงิน คนอื่นที่ไม่ใช่ตัวคุณเอง
              </p>
            ) : (
              <p className="text-xs text-muted-foreground leading-snug">
                ผู้อนุมัติต้องเป็นคนละคนกับผู้ทำรายการ (Segregation of Duties)
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => {
              resetForm();
              onClose();
            }}
            disabled={voidMutation.isPending}
          >
            ปิด
          </Button>
          <Button
            variant="destructive"
            onClick={() => receiptId && voidMutation.mutate(receiptId)}
            disabled={!reason.trim() || !approvedById || voidMutation.isPending}
          >
            {voidMutation.isPending ? 'กำลังยกเลิก...' : 'ยืนยันยกเลิก'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
