import { useMemo, useState } from 'react';
import { UseMutationResult } from '@tanstack/react-query';
import DataTable, { Column } from '@/components/ui/DataTable';
import { formatDateShort } from '@/utils/formatters';
import { useDebounce } from '@/hooks/useDebounce';
import { useIsMobile } from '@/hooks/useIsMobile';
import { PurchaseOrder, ApprovePOPayload } from '../types';
import { ApprovePODialog } from './ApprovePODialog';
import type { SupplierPaymentMethod } from './wizard/PaymentSection';
import { cn } from '@/lib/utils';
import { receiveProgress, isOverdue, supplierContactIsRedundant, canCancel, splitLeadingTag, pieceCount, itemsSummary } from '../po-list.util';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { POCard } from './POCard';
import { getStatusBadgeProps, poStatusMap, poPaymentStatusMap } from '@/lib/status-badges';
import { PackageCheck, Check, X, Ban, FileText, Search, ShoppingCart, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type PeriodFilter = '' | 'this-month' | 'last-month' | 'this-quarter' | 'this-year';

export interface POListTabProps {
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  pos: PurchaseOrder[];
  isLoading: boolean;
  openDetailModal: (po: PurchaseOrder) => void;
  openReceiveModal: (po: PurchaseOrder) => void;
  openPaymentModal: (po: PurchaseOrder) => void;
  approveMutation: UseMutationResult<unknown, unknown, ApprovePOPayload, unknown>;
  orderMutation: UseMutationResult<unknown, unknown, string, unknown>;
  rejectPOMutation: UseMutationResult<unknown, unknown, { id: string; reason: string }, unknown>;
  cancelMutation: UseMutationResult<unknown, unknown, string, unknown>;
  setConfirmDialog: (value: { open: boolean; message: string; action: () => void }) => void;
  suppliers: { id: string; name: string; hasVat?: boolean; paymentMethods?: SupplierPaymentMethod[] }[];
  overdueOnly: boolean;
  setOverdueOnly: (value: boolean) => void;
}

const periodOptions: { value: PeriodFilter; label: string }[] = [
  { value: '', label: 'ทุกช่วงเวลา' },
  { value: 'this-month', label: 'เดือนนี้' },
  { value: 'last-month', label: 'เดือนที่แล้ว' },
  { value: 'this-quarter', label: 'ไตรมาสนี้' },
  { value: 'this-year', label: 'ปีนี้' },
];

function periodRange(period: PeriodFilter): { start: Date; end: Date } | null {
  if (!period) return null;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === 'this-month') {
    return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
  }
  if (period === 'last-month') {
    return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
  }
  if (period === 'this-quarter') {
    const qStart = Math.floor(m / 3) * 3;
    return { start: new Date(y, qStart, 1), end: new Date(y, qStart + 3, 1) };
  }
  if (period === 'this-year') {
    return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) };
  }
  return null;
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
  orderMutation,
  rejectPOMutation,
  cancelMutation,
  setConfirmDialog,
  suppliers,
  overdueOnly,
  setOverdueOnly,
}: POListTabProps) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [supplierFilter, setSupplierFilter] = useState('');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('');
  const [approveDialog, setApproveDialog] = useState<{ open: boolean; po: PurchaseOrder | null }>({ open: false, po: null });
  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; po: PurchaseOrder | null; reason: string }>({
    open: false,
    po: null,
    reason: '',
  });

  const filteredPos = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const range = periodRange(periodFilter);
    return pos.filter((po) => {
      if (overdueOnly && !isOverdue(po)) return false;
      if (supplierFilter && po.supplier.id !== supplierFilter) return false;
      if (range) {
        const d = new Date(po.orderDate);
        if (d < range.start || d >= range.end) return false;
      }
      if (q) {
        const hay = [po.poNumber, po.supplier.name, po.supplier.contactName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [pos, debouncedSearch, supplierFilter, periodFilter, overdueOnly]);

  const clearAll = () => {
    setSearch('');
    setStatusFilter('');
    setSupplierFilter('');
    setPeriodFilter('');
    setOverdueOnly(false);
  };

  const selectedSupplierName = suppliers.find((s) => s.id === supplierFilter)?.name || supplierFilter;
  const selectedPeriodLabel = periodOptions.find((p) => p.value === periodFilter)?.label || periodFilter;

  const isMobile = useIsMobile();

  // Shared action handlers — used by both the desktop table action column and
  // the mobile POCard so the two views can never drift in behavior.
  // Approve = order + pay in one box (owner 2026-09-06) — the bare confirm is gone.
  const onApprove = (po: PurchaseOrder) => setApproveDialog({ open: true, po });
  const closeApprove = () => setApproveDialog({ open: false, po: null });
  const onOrder = (po: PurchaseOrder) =>
    setConfirmDialog({
      open: true,
      message: `ยืนยันสั่งซื้อ PO ${po.poNumber}? (สถานะจะเปลี่ยนเป็น "สั่งซื้อแล้ว")`,
      action: () => orderMutation.mutate(po.id),
    });
  const onReject = (po: PurchaseOrder) => setRejectDialog({ open: true, po, reason: '' });
  const onCancel = (po: PurchaseOrder) =>
    setConfirmDialog({
      open: true,
      message:
        po.status === 'ORDERED'
          ? `ต้องการยกเลิก PO ${po.poNumber}? สั่งซื้อแล้วแต่ยังไม่ได้รับของ — ยกเลิกแล้วต้องแจ้งผู้ขายเอง`
          : `ต้องการยกเลิก PO ${po.poNumber}?`,
      action: () => cancelMutation.mutate(po.id),
    });

  // Every column but the supplier has a fixed width (DataTable switches to table-fixed), badges
  // never wrap and long names truncate — the owner's list showed a supplier on three lines and
  // "รับบางส่วน" broken mid-word (2026-09-07).
  const columns: Column<PurchaseOrder>[] = [
    {
      key: 'poNumber',
      label: 'เลข PO',
      sortable: true,
      // the date lives under the number now — sorting this column keeps ordering by date, not by
      // the PO string (two number formats coexist: PO-2026-09-011 and the older PO-2026-003)
      sortKey: 'orderDate',
      width: '150px',
      render: (po) => (
        <div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openDetailModal(po);
            }}
            className="font-mono font-semibold text-primary hover:underline whitespace-nowrap"
          >
            {po.poNumber}
          </button>
          <div className="mt-0.5 text-xs text-muted-foreground whitespace-nowrap">สั่ง {formatDateShort(po.orderDate)}</div>
        </div>
      ),
    },
    {
      key: 'supplier',
      label: 'ผู้จัดจำหน่าย',
      sortable: true,
      sortKey: 'supplier.name',
      render: (po) => {
        const { tag, name } = splitLeadingTag(po.supplier.name);
        const sameName = supplierContactIsRedundant(po.supplier);
        return (
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium" title={po.supplier.name}>
                {name}
              </span>
              {tag && (
                <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] leading-[18px] font-medium whitespace-nowrap text-muted-foreground">
                  {tag}
                </span>
              )}
            </div>
            {po.supplier.contactName && !sameName && (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{po.supplier.contactName}</div>
            )}
          </div>
        );
      },
    },
    {
      key: 'items',
      label: 'รายการ',
      sortable: false,
      width: '180px',
      render: (po) => {
        const summary = itemsSummary(po);
        return (
          <div className="min-w-0">
            <div className="whitespace-nowrap">
              <span className="font-medium">{po.items.length} รายการ</span>
              <span className="text-muted-foreground"> · {pieceCount(po)} ชิ้น</span>
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground" title={summary}>
              {summary}
            </div>
          </div>
        );
      },
    },
    {
      key: 'totalAmount',
      label: 'ยอดรวม',
      sortable: true,
      width: '150px',
      align: 'right',
      render: (po) => {
        const vat = Number(po.vatAmount);
        const discount = (Number(po.discount) || 0) + (Number(po.discountAfterVat) || 0);
        return (
          <div>
            <div className="whitespace-nowrap">
              <span className="font-mono font-semibold tabular-nums">{Number(po.netAmount ?? po.totalAmount).toLocaleString()}</span>{' '}
              <span className="text-xs text-muted-foreground">บาท</span>
            </div>
            <div className={cn('mt-0.5 text-xs whitespace-nowrap', vat > 0 ? 'text-primary' : 'text-muted-foreground')}>
              {vat > 0 ? `รวม VAT ${vat.toLocaleString()}` : 'ไม่มี VAT'}
            </div>
            {discount > 0 && <div className="text-xs text-destructive whitespace-nowrap">ส่วนลด -{discount.toLocaleString()}</div>}
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'สถานะ',
      sortable: true,
      width: '136px',
      render: (po) => {
        const cfg = getStatusBadgeProps(po.status, poStatusMap);
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge variant={cfg.variant} appearance={cfg.appearance} className="whitespace-nowrap">
              {cfg.label}
            </Badge>
            {isOverdue(po) && (
              <Badge variant="destructive" appearance="light" className="gap-1 leading-snug whitespace-nowrap">
                <AlertTriangle className="size-3" />
                เลยกำหนด
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      key: 'paymentStatus',
      label: 'การจ่ายเงิน',
      sortable: true,
      width: '132px',
      render: (po) => {
        const cfg = getStatusBadgeProps(po.paymentStatus || 'UNPAID', poPaymentStatusMap);
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              openPaymentModal(po);
            }}
            className="cursor-pointer hover:opacity-80"
            title="แก้ไขสถานะการจ่ายเงิน"
          >
            <Badge variant={cfg.variant} appearance={cfg.appearance} className="whitespace-nowrap">
              {cfg.label}
            </Badge>
          </button>
        );
      },
    },
    {
      key: 'received',
      label: 'รับสินค้า',
      width: '150px',
      render: (po) => {
        const { received, ordered, pct } = receiveProgress(po);
        const done = ordered > 0 && received >= ordered;
        return (
          <div className="flex items-center gap-2.5">
            <span className="text-sm whitespace-nowrap tabular-nums leading-snug">
              <span className={cn('font-mono font-semibold', done && 'text-success')}>{received}</span>
              <span className="text-muted-foreground">/{ordered}</span>
            </span>
            {ordered > 0 && (
              <div className="h-1.5 flex-1 rounded-full bg-muted">
                <div className={cn('h-1.5 rounded-full', done ? 'bg-success' : 'bg-primary')} style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: '',
      hideable: false,
      width: '148px',
      align: 'right',
      stickyRight: true,
      render: (po) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => openDetailModal(po)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="ดูรายละเอียด"
            aria-label={`ดูรายละเอียด ${po.poNumber}`}
          >
            <FileText className="size-4" />
          </button>
          {po.status === 'APPROVED' && (
            <button
              onClick={() => onOrder(po)}
              disabled={orderMutation.isPending}
              className="p-1.5 rounded-md text-info hover:bg-info/10 transition-colors disabled:opacity-50"
              title="สั่งซื้อ"
              aria-label={`สั่งซื้อ ${po.poNumber}`}
            >
              <ShoppingCart className="size-4" />
            </button>
          )}
          {['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status) && (
            <button
              onClick={() => openReceiveModal(po)}
              className="p-1.5 rounded-md text-primary hover:bg-primary/10 transition-colors"
              title="รับสินค้า"
              aria-label={`รับสินค้า ${po.poNumber}`}
            >
              <PackageCheck className="size-4" />
            </button>
          )}
          {po.status === 'DRAFT' && (
            <>
              <button
                onClick={() => onApprove(po)}
                disabled={approveMutation.isPending}
                className="p-1.5 rounded-md text-success hover:bg-success/10 transition-colors disabled:opacity-50"
                title="อนุมัติ"
                aria-label={`อนุมัติ ${po.poNumber}`}
              >
                <Check className="size-4" />
              </button>
              <button
                onClick={() => onReject(po)}
                disabled={rejectPOMutation.isPending}
                className="p-1.5 rounded-md text-warning-strong hover:bg-warning/10 transition-colors disabled:opacity-50"
                title="ปฏิเสธ"
                aria-label={`ปฏิเสธ ${po.poNumber}`}
              >
                <X className="size-4" />
              </button>
            </>
          )}
          {/* also for an ORDERED PO with nothing received yet (approve lands on ORDERED now) */}
          {canCancel(po) && (
            <button
              onClick={() => onCancel(po)}
              disabled={cancelMutation.isPending}
              className="p-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
              title="ยกเลิก"
              aria-label={`ยกเลิก ${po.poNumber}`}
            >
              <Ban className="size-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  const hasFilter = Boolean(search || statusFilter || supplierFilter || periodFilter || overdueOnly);
  const EmptyIcon = hasFilter ? Search : ShoppingCart;
  const emptyTitle = hasFilter ? 'ไม่พบใบสั่งซื้อที่ตรงกับตัวกรอง' : 'ยังไม่มีใบสั่งซื้อ';
  const emptyDesc = hasFilter
    ? 'ลองล้างตัวกรองหรือเปลี่ยนคำค้นหา'
    : 'กด "+ สร้าง PO" ที่มุมขวาบนเพื่อเริ่มสั่งซื้อสินค้าจากผู้จัดจำหน่าย';

  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="ค้นหาเลข PO, ผู้จัดจำหน่าย..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 border border-input rounded-lg text-sm bg-background focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm bg-background focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background transition-colors outline-hidden"
        >
          <option value="">ทุกสถานะ</option>
          <option value="DRAFT">รออนุมัติ</option>
          <option value="APPROVED">อนุมัติแล้ว</option>
          <option value="ORDERED">สั่งซื้อแล้ว</option>
          <option value="PARTIALLY_RECEIVED">รับบางส่วน</option>
          <option value="FULLY_RECEIVED">รับครบแล้ว</option>
          <option value="CANCELLED">ยกเลิก</option>
        </select>
        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm bg-background focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden max-w-[220px]"
        >
          <option value="">ทุกผู้จัดจำหน่าย</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={periodFilter}
          onChange={(e) => setPeriodFilter(e.target.value as PeriodFilter)}
          className="px-3 py-2 border border-input rounded-lg text-sm bg-background focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
        >
          {periodOptions.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Active filter chips */}
      {hasFilter && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-muted-foreground">ตัวกรองที่ใช้:</span>
          {search && <FilterChip label={`ค้นหา: "${search}"`} onRemove={() => setSearch('')} />}
          {statusFilter && (
            <FilterChip
              label={`สถานะ: ${
                {
                  DRAFT: 'รออนุมัติ',
                  APPROVED: 'อนุมัติแล้ว',
                  ORDERED: 'สั่งซื้อแล้ว',
                  PARTIALLY_RECEIVED: 'รับบางส่วน',
                  FULLY_RECEIVED: 'รับครบแล้ว',
                  CANCELLED: 'ยกเลิก',
                }[statusFilter] || statusFilter
              }`}
              onRemove={() => setStatusFilter('')}
            />
          )}
          {supplierFilter && (
            <FilterChip label={`ผู้จัดจำหน่าย: ${selectedSupplierName}`} onRemove={() => setSupplierFilter('')} />
          )}
          {periodFilter && (
            <FilterChip label={`ช่วงเวลา: ${selectedPeriodLabel}`} onRemove={() => setPeriodFilter('')} />
          )}
          {overdueOnly && (
            <FilterChip label="เฉพาะที่เลยกำหนดส่ง" onRemove={() => setOverdueOnly(false)} />
          )}
          <button
            onClick={clearAll}
            className="ml-1 text-xs text-muted-foreground hover:text-foreground underline"
          >
            ล้างทั้งหมด
          </button>
        </div>
      )}

      {isMobile ? (
        /* Mobile: reflow into tappable cards so row actions are reachable (44px) */
        isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-32 rounded-xl border border-border/50 bg-card animate-pulse" />
            ))}
          </div>
        ) : filteredPos.length === 0 ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center text-center gap-2">
              <EmptyIcon className="size-10 text-muted-foreground/50" />
              <p className="font-medium text-foreground leading-snug">{emptyTitle}</p>
              <p className="text-sm text-muted-foreground leading-snug">{emptyDesc}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredPos.map((po) => (
              <POCard
                key={po.id}
                po={po}
                openDetailModal={openDetailModal}
                openReceiveModal={openReceiveModal}
                openPaymentModal={openPaymentModal}
                onApprove={onApprove}
                onOrder={onOrder}
                onReject={onReject}
                onCancel={onCancel}
                approvePending={approveMutation.isPending}
                orderPending={orderMutation.isPending}
                rejectPending={rejectPOMutation.isPending}
              />
            ))}
          </div>
        )
      ) : (
        <Card>
          <CardContent className="p-0">
            <DataTable
              columns={columns}
              data={filteredPos}
              isLoading={isLoading}
              emptyMessage={emptyTitle}
              emptyIcon={EmptyIcon}
              emptyDescription={emptyDesc}
              columnToggle
              onRowClick={openDetailModal}
              // below this the supplier column would be squeezed — scroll sideways instead (actions stay
              // pinned); 1180 keeps a 1366px laptop (≈1086px of content) from scrolling for most names
              minWidth="1180px"
            />
          </CardContent>
        </Card>
      )}

      <ApprovePODialog
        open={approveDialog.open}
        po={approveDialog.po}
        supplier={suppliers.find((s) => s.id === approveDialog.po?.supplier.id)}
        pending={approveMutation.isPending}
        onClose={closeApprove}
        onReject={(po) => {
          closeApprove();
          setRejectDialog({ open: true, po, reason: '' });
        }}
        onConfirm={(payload) => approveMutation.mutate(payload, { onSuccess: closeApprove })}
      />

      {/* Reject reason dialog */}
      <Dialog
        open={rejectDialog.open}
        onOpenChange={(open) => setRejectDialog((prev) => ({ ...prev, open }))}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ปฏิเสธใบสั่งซื้อ</DialogTitle>
            <DialogDescription>
              กรุณาระบุเหตุผลในการปฏิเสธ {rejectDialog.po?.poNumber}
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={rejectDialog.reason}
            onChange={(e) => setRejectDialog((prev) => ({ ...prev, reason: e.target.value }))}
            placeholder="เหตุผลที่ปฏิเสธ..."
            rows={3}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden resize-none"
            autoFocus
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setRejectDialog({ open: false, po: null, reason: '' })}
              disabled={rejectPOMutation.isPending}
            >
              ยกเลิก
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const reason = rejectDialog.reason.trim();
                if (!reason || !rejectDialog.po) return;
                rejectPOMutation.mutate(
                  { id: rejectDialog.po.id, reason },
                  {
                    onSuccess: () => setRejectDialog({ open: false, po: null, reason: '' }),
                  },
                );
              }}
              disabled={rejectPOMutation.isPending || !rejectDialog.reason.trim()}
            >
              {rejectPOMutation.isPending ? 'กำลังปฏิเสธ...' : 'ยืนยันปฏิเสธ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
      {label}
      <button
        onClick={onRemove}
        className="hover:bg-primary/20 rounded-full p-0.5 transition-colors"
        aria-label={`ลบ ${label}`}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
