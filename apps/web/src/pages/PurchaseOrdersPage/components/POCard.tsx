import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, poStatusMap, poPaymentStatusMap } from '@/lib/status-badges';
import { formatDateShort } from '@/utils/formatters';
import { receiveProgress, isOverdue, supplierContactIsRedundant } from '../po-list.util';
import type { PurchaseOrder } from '../types';
import { PackageCheck, Check, X, Ban, ShoppingCart, AlertTriangle } from 'lucide-react';

// Mobile-only card for the PO list. The desktop view keeps the DataTable; on
// phones (<lg) the table side-scrolls and its row actions land off-screen, so we
// reflow each PO into a tappable card whose status-specific actions are reachable
// 44px touch targets. Mirrors the project card pattern (rounded-xl border bg-card)
// and reuses the same badge maps + receiveProgress/isOverdue helpers as the table
// so the two views never drift. Tokens only — no gray/hex/bg-white.

// 44px touch-target convention (matches ReceivingUnitCard / ConversationItem)
const actionBtn =
  'min-h-11 flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50';

export interface POCardProps {
  po: PurchaseOrder;
  openDetailModal: (po: PurchaseOrder) => void;
  openReceiveModal: (po: PurchaseOrder) => void;
  openPaymentModal: (po: PurchaseOrder) => void;
  onApprove: (po: PurchaseOrder) => void;
  onOrder: (po: PurchaseOrder) => void;
  onReject: (po: PurchaseOrder) => void;
  onCancel: (po: PurchaseOrder) => void;
  approvePending: boolean;
  orderPending: boolean;
  rejectPending: boolean;
}

function POCardImpl({
  po,
  openDetailModal,
  openReceiveModal,
  openPaymentModal,
  onApprove,
  onOrder,
  onReject,
  onCancel,
  approvePending,
  orderPending,
  rejectPending,
}: POCardProps) {
  const statusCfg = getStatusBadgeProps(po.status, poStatusMap);
  const payCfg = getStatusBadgeProps(po.paymentStatus || 'UNPAID', poPaymentStatusMap);
  const { received, ordered, pct } = receiveProgress(po);
  const receiveDone = ordered > 0 && received >= ordered;
  const overdue = isOverdue(po);
  const canReceive = ['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status);
  const sameName = supplierContactIsRedundant(po.supplier);

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div
      onClick={() => openDetailModal(po)}
      className="rounded-xl border border-border/50 bg-card shadow-sm p-4 leading-snug cursor-pointer hover:bg-accent/40 transition-colors"
    >
      {/* Header: PO number + net amount */}
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={stop(() => openDetailModal(po))}
          className="font-medium text-primary hover:underline text-left"
        >
          {po.poNumber}
        </button>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold tabular-nums leading-none">
            {Number(po.netAmount ?? po.totalAmount).toLocaleString()}
            <span className="text-xs font-normal text-muted-foreground"> บาท</span>
          </div>
          {Number(po.vatAmount) > 0 && (
            <div className="text-2xs text-primary mt-0.5">รวม VAT {Number(po.vatAmount).toLocaleString()}</div>
          )}
        </div>
      </div>

      {/* Supplier */}
      <div className="mt-1.5">
        <div className="font-medium text-foreground">{po.supplier.name}</div>
        {po.supplier.contactName && !sameName && (
          <div className="text-xs text-muted-foreground">{po.supplier.contactName}</div>
        )}
      </div>

      {/* Meta: order date + item count */}
      <div className="mt-1 text-xs text-muted-foreground">
        {formatDateShort(po.orderDate)} · {po.items.length} รายการ
      </div>

      {/* Status + payment chips */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant={statusCfg.variant} appearance={statusCfg.appearance}>
          {statusCfg.label}
        </Badge>
        {overdue && (
          <Badge variant="destructive" appearance="light" className="gap-1 leading-snug">
            <AlertTriangle className="size-3" />
            เลยกำหนด
          </Badge>
        )}
        <button
          onClick={stop(() => openPaymentModal(po))}
          title="แก้ไขสถานะการจ่ายเงิน"
          aria-label={`แก้ไขสถานะการจ่ายเงิน ${po.poNumber}`}
          className="hover:opacity-80"
        >
          <Badge variant={payCfg.variant} appearance={payCfg.appearance}>
            {payCfg.label}
          </Badge>
        </button>
      </div>

      {/* Receive progress — label always shown (mirrors desktop column); bar gated on ordered>0 */}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs whitespace-nowrap tabular-nums">
          <span className="text-muted-foreground">รับแล้ว </span>
          <span className={receiveDone ? 'text-success font-semibold' : 'font-medium'}>{received}</span>
          <span className="text-muted-foreground">/{ordered}</span>
        </span>
        {ordered > 0 && (
          <div className="flex-1 bg-secondary rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full ${receiveDone ? 'bg-success' : 'bg-primary'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>

      {/* Status-specific actions (detail is the whole-card tap + PO# button) */}
      {(canReceive || po.status === 'DRAFT') && (
        <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          {po.status === 'APPROVED' && (
            <button
              onClick={stop(() => onOrder(po))}
              disabled={orderPending}
              className={`${actionBtn} border-info/30 text-info hover:bg-info/10`}
              aria-label={`สั่งซื้อ ${po.poNumber}`}
            >
              <ShoppingCart className="size-4" />
              สั่งซื้อ
            </button>
          )}
          {canReceive && (
            <button
              onClick={stop(() => openReceiveModal(po))}
              className={`${actionBtn} border-primary/30 text-primary hover:bg-primary/10`}
              aria-label={`รับสินค้า ${po.poNumber}`}
            >
              <PackageCheck className="size-4" />
              รับสินค้า
            </button>
          )}
          {po.status === 'DRAFT' && (
            <>
              <button
                onClick={stop(() => onApprove(po))}
                disabled={approvePending}
                className={`${actionBtn} border-success/30 text-success hover:bg-success/10`}
                aria-label={`อนุมัติ ${po.poNumber}`}
              >
                <Check className="size-4" />
                อนุมัติ
              </button>
              <button
                onClick={stop(() => onReject(po))}
                disabled={rejectPending}
                className={`${actionBtn} border-warning/30 text-warning hover:bg-warning/10`}
                aria-label={`ปฏิเสธ ${po.poNumber}`}
              >
                <X className="size-4" />
                ปฏิเสธ
              </button>
              <button
                onClick={stop(() => onCancel(po))}
                className={`${actionBtn} border-destructive/30 text-destructive hover:bg-destructive/10`}
                aria-label={`ยกเลิก ${po.poNumber}`}
              >
                <Ban className="size-4" />
                ยกเลิก
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export const POCard = memo(POCardImpl);
