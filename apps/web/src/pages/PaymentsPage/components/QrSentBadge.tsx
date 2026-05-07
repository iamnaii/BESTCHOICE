import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { QrCode, Send, X, CheckCircle2 } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface PartialPaymentLink {
  id: string;
  paymentId: string;
  amount: string;
  paymentUrl: string | null;
  token: string;
  status: 'ACTIVE' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  expiresAt: string;
  createdAt: string;
}

/**
 * Small inline badge that surfaces an active partial-payment QR sent to the
 * customer for this Payment row. Polls every 30s for status changes (cron
 * also flips ACTIVE → EXPIRED hourly server-side). Lets the cashier resend,
 * cancel, or peek at the QR via "ดู QR" without leaving the payments page.
 */
export function QrSentBadge({ paymentId }: { paymentId: string }) {
  const queryClient = useQueryClient();

  const { data } = useQuery<PartialPaymentLink | null>({
    queryKey: ['partial-qr', paymentId],
    queryFn: async () =>
      (await api.get<PartialPaymentLink | null>(`/payments/${paymentId}/partial-qr/active`)).data,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const [showQr, setShowQr] = useState(false);
  const [pendingCancel, setPendingCancel] = useState(false);

  const cancelMutation = useMutation({
    mutationFn: async () => api.delete(`/payments/${paymentId}/partial-qr`),
    onSuccess: () => {
      toast.success('ยกเลิก QR แล้ว');
      queryClient.invalidateQueries({ queryKey: ['partial-qr', paymentId] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // Tick every minute so the countdown re-renders without re-fetching from API.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const remaining = useMemo(() => {
    if (!data) return null;
    return new Date(data.expiresAt).getTime() - now;
  }, [data, now]);

  if (!data) return null;

  const minutesLeft = remaining != null ? Math.max(0, Math.floor(remaining / 60_000)) : 0;
  const hoursLeft = Math.floor(minutesLeft / 60);
  const display =
    hoursLeft >= 1
      ? `เหลือ ${hoursLeft} ชม. ${minutesLeft % 60} นาที`
      : `เหลือ ${minutesLeft} นาที`;

  // Visual urgency tier — drives badge color
  const tier =
    minutesLeft > 60
      ? 'fresh'
      : minutesLeft > 30
        ? 'mid'
        : minutesLeft > 0
          ? 'warn'
          : 'expired';

  const badgeVariant =
    tier === 'warn' ? 'warning' : tier === 'expired' ? 'secondary' : 'info';

  const amountThb = Number(data.amount).toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  return (
    <div className="flex flex-col gap-1.5 mt-1">
      <Badge variant={badgeVariant} appearance="default" size="sm" className="gap-1.5">
        <Send className="size-3" />
        QR ส่งแล้ว · ฿{amountThb}
      </Badge>
      <div className="text-[10px] text-muted-foreground font-mono leading-tight">
        {tier === 'expired' ? 'หมดอายุ · กดส่งใหม่' : display}
      </div>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] gap-1"
          onClick={() => setShowQr(true)}
        >
          <QrCode className="size-3" />
          ดู QR
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] gap-1 text-destructive hover:text-destructive"
          onClick={() => setPendingCancel(true)}
        >
          <X className="size-3" />
          ยกเลิก
        </Button>
      </div>

      <Dialog open={showQr} onOpenChange={setShowQr}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="size-4" />
              QR ที่ส่งให้ลูกค้า
            </DialogTitle>
            <DialogDescription>
              ลูกค้าเดินมาที่ร้านสามารถสแกน QR นี้แทนได้ · จ่ายผ่าน PaySolutions PromptPay
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-3">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=10&data=${encodeURIComponent(data.paymentUrl ?? '')}`}
              alt="QR ชำระเงิน"
              className="size-64 rounded-lg border border-border bg-white p-2"
            />
            <div className="text-sm font-mono">฿{amountThb}</div>
            <div className="text-xs text-muted-foreground font-mono">REF {data.token}</div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingCancel}
        onOpenChange={setPendingCancel}
        title="ยกเลิก QR ที่ส่งไปแล้ว"
        description="ถ้าลูกค้าเปิด LINE มาแล้วจะสแกน QR นี้ไม่ได้ · เลือก 'บันทึกแทน' ได้หากลูกค้าจ่ายเงินสดมาแทน"
        confirmLabel="ยกเลิก QR"
        variant="destructive"
        onConfirm={() => cancelMutation.mutate()}
      />
    </div>
  );
}

/** Mini "PAID" success badge — shows briefly after webhook fires (before UI refetches Payment row). */
export function QrPaidIndicator() {
  return (
    <Badge variant="success" appearance="default" size="sm" className="gap-1.5">
      <CheckCircle2 className="size-3" />
      ชำระผ่าน QR แล้ว
    </Badge>
  );
}
