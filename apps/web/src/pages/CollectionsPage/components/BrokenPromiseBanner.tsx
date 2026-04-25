import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';

/**
 * P1 Task 14 — Broken-Promise Auto-Suggest banner.
 *
 * Reads `GET /overdue/promise-due-reminders` (DunningActions stamped today
 * by BrokenPromiseReminderCron at 09:00 BKK) and renders a single-line banner
 * inviting the collector to bulk-send a LINE reminder to every customer
 * whose promise is due TODAY.
 *
 * Hidden when there are 0 reminders so it doesn't add visual noise on quiet
 * days. Bulk-LINE button is disabled when 0 contracts have a `lineId`.
 */

interface ReminderRow {
  id: string;
  contractId: string;
  contractNumber: string;
  customerName: string;
  hasLine: boolean;
  createdAt: string;
}

interface ReminderResponse {
  total: number;
  withLine: number;
  contractIds: string[];
  data: ReminderRow[];
}

const PROMISE_DUE_TEMPLATE =
  'เรียนคุณ {{customerName}}, วันนี้ครบกำหนดนัดชำระสัญญา {{contractNumber}} — กรุณาชำระภายในวันนี้เพื่อหลีกเลี่ยงค่าปรับและการดำเนินการต่อไป';

export default function BrokenPromiseBanner() {
  const qc = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const q = useQuery<ReminderResponse>({
    queryKey: ['promise-due-reminders'],
    queryFn: async () => {
      const { data } = await api.get<ReminderResponse>('/overdue/promise-due-reminders');
      return data;
    },
    // Re-poll every 10 minutes so the banner keeps in sync if cron fires
    // while the collector has the page open (e.g. shift changeover at 09:00).
    refetchInterval: 10 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
  });

  const bulkSend = useMutation({
    mutationFn: async (contractIds: string[]) => {
      // Use customMessage with placeholder substitution handled by bulkSendLine
      // — we do client-side substitution here because the server-side template
      // resolver only knows {{customerName}} and {{contractNumber}}, which is
      // exactly what we need.
      const { data } = await api.post<{ sent: number; failed: number; total: number }>(
        '/overdue/bulk/send-line',
        {
          contractIds,
          customMessage: PROMISE_DUE_TEMPLATE,
        },
      );
      return data;
    },
    onSuccess: (res) => {
      toast.success(`ส่ง LINE สำเร็จ ${res.sent}/${res.total} ราย (ล้มเหลว ${res.failed})`);
      qc.invalidateQueries({ queryKey: ['promise-due-reminders'] });
      qc.invalidateQueries({ queryKey: ['collections-queue'] });
    },
    onError: () => {
      toast.error('ส่ง LINE ไม่สำเร็จ — กรุณาลองใหม่');
    },
    onSettled: () => setSubmitting(false),
  });

  const lineEligibleIds = useMemo(
    () => (q.data?.data ?? []).filter((r) => r.hasLine).map((r) => r.contractId),
    [q.data],
  );

  if (q.isLoading || q.isError || !q.data || q.data.total === 0) return null;

  const total = q.data.total;
  const withLine = q.data.withLine;
  const noLine = total - withLine;

  const onBulkSend = () => {
    if (lineEligibleIds.length === 0 || submitting) return;
    setSubmitting(true);
    bulkSend.mutate(lineEligibleIds);
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 mb-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-lg bg-primary/10 p-2 text-primary">
          <Bell className="size-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground leading-snug">
            วันนี้มีนัดครบกำหนด {total} ราย — ส่ง LINE เตือนทั้งหมด?
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
            มี LINE ID พร้อมส่ง {withLine} ราย
            {noLine > 0 && ` · ไม่มี LINE ID ${noLine} ราย (ต้องโทรหรือ SMS แทน)`}
          </div>
        </div>
        <button
          type="button"
          onClick={onBulkSend}
          disabled={lineEligibleIds.length === 0 || submitting}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-3.5" aria-hidden="true" />
          )}
          ส่ง LINE ทั้งหมด ({lineEligibleIds.length})
        </button>
      </div>
    </div>
  );
}
