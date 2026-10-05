import { useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatDateTime } from '@/utils/formatters';
import { useAdjustmentList, useAdjustmentMutations } from '@/pages/StockAdjustmentsPage/hooks/useStockAdjustments';
import { REASON_LABEL, canCancel, productStatusLabel } from '@/pages/StockAdjustmentsPage/stock-adjustment.util';

/**
 * แบนเนอร์บนหน้าสินค้าเมื่อเครื่องอยู่สถานะ ADJUSTMENT_PENDING (ก้อน 3) — บอกเลขคำขอ/เหตุผล/ผู้ขอ
 * ลิงก์ไปหน้าตัดสินค้า และให้ผู้ขอ/เจ้าของยกเลิกคำขอได้จากตรงนี้ (ขาย/จอง/โอนทำไม่ได้ระหว่างรอ)
 */
export default function AdjustmentPendingBanner({ productId, status }: { productId: string; status: string }) {
  const { user } = useAuth();
  const pending = status === 'ADJUSTMENT_PENDING';
  const list = useAdjustmentList({ productId, status: 'PENDING_APPROVAL', limit: 1 }, pending);
  const { cancel } = useAdjustmentMutations();
  const [confirm, setConfirm] = useState(false);
  if (!pending) return null;
  const row = list.data?.data[0];
  const me = { id: user?.id ?? '', role: user?.role ?? '' };
  return (
    <div className="mb-5 flex flex-wrap items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
      <AlertTriangle className="size-5 shrink-0 text-warning-strong mt-0.5" />
      <div className="flex-1 min-w-[200px] text-sm leading-snug">
        <div className="font-medium text-warning-strong">เครื่องนี้มีคำขอตัดสินค้ารออนุมัติ — ขาย / จอง / โอนไม่ได้จนกว่าเจ้าของจะพิจารณา</div>
        {row ? (
          <div className="text-xs text-muted-foreground mt-0.5">
            {row.requestNumber} · {REASON_LABEL[row.reason]} · ขอโดย {row.adjustedBy.name} · {formatDateTime(row.createdAt)} · สถานะก่อนขอ{' '}
            {productStatusLabel(row.previousStatus)}
            {row.notes ? ` · ${row.notes}` : ''}
          </div>
        ) : list.isLoading ? (
          <div className="text-xs text-muted-foreground mt-0.5">กำลังโหลดคำขอ...</div>
        ) : null}
      </div>
      <div className="flex gap-2">
        {row && (
          <Button asChild size="sm" variant="outline">
            <Link to={`/stock/adjustments?focus=${row.id}`}>ดูคำขอ</Link>
          </Button>
        )}
        {row && canCancel(row, me) && (
          <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={() => setConfirm(true)}>
            ยกเลิกคำขอ
          </Button>
        )}
      </div>
      {row && (
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title="ยกเลิกคำขอตัดสินค้า"
          description={`ยกเลิก ${row.requestNumber ?? 'คำขอนี้'} — เครื่องจะกลับสถานะ "${productStatusLabel(row.previousStatus)}"`}
          confirmLabel="ยกเลิกคำขอ"
          variant="destructive"
          loading={cancel.isPending}
          onConfirm={() => cancel.mutate(row.id)}
        />
      )}
    </div>
  );
}
