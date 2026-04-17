import { UseMutationResult } from '@tanstack/react-query';
import DataTable from '@/components/ui/DataTable';
import { formatDateShort } from '@/utils/formatters';
import { PurchaseOrder } from '../types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getStatusBadgeProps, poStatusMap, poPaymentStatusMap } from '@/lib/status-badges';

export interface POListTabProps {
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  pos: PurchaseOrder[];
  isLoading: boolean;
  openDetailModal: (po: PurchaseOrder) => void;
  openReceiveModal: (po: PurchaseOrder) => void;
  openPaymentModal: (po: PurchaseOrder) => void;
  approveMutation: UseMutationResult<unknown, unknown, string, unknown>;
  rejectPOMutation: UseMutationResult<unknown, unknown, { id: string; reason: string }, unknown>;
  cancelMutation: UseMutationResult<unknown, unknown, string, unknown>;
  setConfirmDialog: (value: { open: boolean; message: string; action: () => void }) => void;
}

export function POListTab({
  statusFilter,
  setStatusFilter,
  pos,
  isLoading,
  openDetailModal,
  openReceiveModal,
  openPaymentModal,
  approveMutation,
  rejectPOMutation,
  cancelMutation,
  setConfirmDialog,
}: POListTabProps) {
  const columns = [
    {
      key: 'poNumber',
      label: 'เลข PO',
      render: (po: PurchaseOrder) => (
        <button
          onClick={() => openDetailModal(po)}
          className="font-medium text-primary hover:underline"
        >
          {po.poNumber}
        </button>
      ),
    },
    {
      key: 'supplier',
      label: 'ผู้ขาย',
      render: (po: PurchaseOrder) => (
        <div>
          <div className="font-medium">{po.supplier.name}</div>
          <div className="text-xs text-muted-foreground">{po.supplier.contactName}</div>
        </div>
      ),
    },
    {
      key: 'orderDate',
      label: 'วันที่สั่ง',
      render: (po: PurchaseOrder) => (
        <span className="text-sm">{formatDateShort(po.orderDate)}</span>
      ),
    },
    {
      key: 'items',
      label: 'รายการ',
      render: (po: PurchaseOrder) => (
        <span className="text-sm">{po.items.length} รายการ</span>
      ),
    },
    {
      key: 'totalAmount',
      label: 'ยอดรวม',
      render: (po: PurchaseOrder) => (
        <div>
          <span className="text-sm font-medium">{Number(po.netAmount ?? po.totalAmount).toLocaleString()} บาท</span>
          {Number(po.discount) > 0 && (
            <div className="text-xs text-destructive">ส่วนลด -{Number(po.discount).toLocaleString()}</div>
          )}
          {Number(po.vatAmount) > 0 && (
            <div className="text-xs text-primary">รวม VAT {Number(po.vatAmount).toLocaleString()}</div>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (po: PurchaseOrder) => {
        const cfg = getStatusBadgeProps(po.status, poStatusMap);
        return <Badge variant={cfg.variant} appearance={cfg.appearance}>{cfg.label}</Badge>;
      },
    },
    {
      key: 'paymentStatus',
      label: 'การจ่ายเงิน',
      render: (po: PurchaseOrder) => {
        const cfg = getStatusBadgeProps(po.paymentStatus || 'UNPAID', poPaymentStatusMap);
        return (
          <button onClick={() => openPaymentModal(po)} className="cursor-pointer hover:opacity-80">
            <Badge variant={cfg.variant} appearance={cfg.appearance}>{cfg.label}</Badge>
          </button>
        );
      },
    },
    {
      key: 'received',
      label: 'รับสินค้า',
      render: (po: PurchaseOrder) => {
        const totalOrdered = po.items.reduce((s, i) => s + i.quantity, 0);
        const totalReceived = po.items.reduce((s, i) => s + i.receivedQty, 0);
        return (
          <div className="flex items-center gap-2">
            <span className="text-sm">
              {totalReceived}/{totalOrdered}
            </span>
            {totalOrdered > 0 && (
              <div className="w-16 bg-secondary rounded-full h-1.5">
                <div
                  className="bg-success h-1.5 rounded-full"
                  style={{ width: `${Math.min((totalReceived / totalOrdered) * 100, 100)}%` }}
                />
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: '',
      render: (po: PurchaseOrder) => (
        <div className="flex gap-2">
          {['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status) && (
            <button
              onClick={() => openReceiveModal(po)}
              className="text-primary hover:text-primary/90 text-sm font-medium"
            >
              รับสินค้า
            </button>
          )}
          {po.status === 'DRAFT' && (
            <>
              <button
                onClick={() => {
                  setConfirmDialog({ open: true, message: `อนุมัติ PO ${po.poNumber}?`, action: () => approveMutation.mutate(po.id) });
                }}
                disabled={approveMutation.isPending}
                className="text-success hover:text-success/90 text-sm font-medium disabled:opacity-50"
              >
                อนุมัติ
              </button>
              <button
                onClick={() => {
                  const reason = prompt('เหตุผลที่ปฏิเสธ:');
                  if (reason) rejectPOMutation.mutate({ id: po.id, reason });
                }}
                disabled={rejectPOMutation.isPending}
                className="text-warning hover:text-warning/90 text-sm font-medium disabled:opacity-50"
              >
                ปฏิเสธ
              </button>
              <button
                onClick={() => {
                  setConfirmDialog({ open: true, message: 'ต้องการยกเลิก PO นี้?', action: () => cancelMutation.mutate(po.id) });
                }}
                className="text-destructive hover:text-destructive/90 text-sm font-medium"
              >
                ยกเลิก
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      {/* Filter */}
      <div className="mb-5">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm bg-background focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background transition-colors outline-hidden"
        >
          <option value="">ทุกสถานะ</option>
          <option value="DRAFT">รออนุมัติ</option>
          <option value="APPROVED">อนุมัติแล้ว</option>
          <option value="PARTIALLY_RECEIVED">รับบางส่วน</option>
          <option value="FULLY_RECEIVED">รับครบแล้ว</option>
          <option value="CANCELLED">ยกเลิก</option>
        </select>
      </div>

      <Card>
        <CardContent className="p-0">
          <DataTable columns={columns} data={pos} isLoading={isLoading} emptyMessage="ยังไม่มีใบสั่งซื้อ" />
        </CardContent>
      </Card>
    </>
  );
}
