import { useMemo, useState } from 'react';
import { UseMutationResult } from '@tanstack/react-query';
import DataTable, { Column } from '@/components/ui/DataTable';
import { formatDateShort } from '@/utils/formatters';
import { PurchaseOrder } from '../types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getStatusBadgeProps, poStatusMap, poPaymentStatusMap } from '@/lib/status-badges';
import { PackageCheck, Check, X, Ban, FileText, Search } from 'lucide-react';
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
  approveMutation: UseMutationResult<unknown, unknown, string, unknown>;
  rejectPOMutation: UseMutationResult<unknown, unknown, { id: string; reason: string }, unknown>;
  cancelMutation: UseMutationResult<unknown, unknown, string, unknown>;
  setConfirmDialog: (value: { open: boolean; message: string; action: () => void }) => void;
  suppliers: { id: string; name: string }[];
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
  rejectPOMutation,
  cancelMutation,
  setConfirmDialog,
  suppliers,
}: POListTabProps) {
  const [search, setSearch] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('');
  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; po: PurchaseOrder | null; reason: string }>({
    open: false,
    po: null,
    reason: '',
  });

  const filteredPos = useMemo(() => {
    const q = search.trim().toLowerCase();
    const range = periodRange(periodFilter);
    return pos.filter((po) => {
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
  }, [pos, search, supplierFilter, periodFilter]);

  const clearAll = () => {
    setSearch('');
    setStatusFilter('');
    setSupplierFilter('');
    setPeriodFilter('');
  };

  const selectedSupplierName = suppliers.find((s) => s.id === supplierFilter)?.name || supplierFilter;
  const selectedPeriodLabel = periodOptions.find((p) => p.value === periodFilter)?.label || periodFilter;

  const columns: Column<PurchaseOrder>[] = [
    {
      key: 'poNumber',
      label: 'เลข PO',
      sortable: true,
      render: (po) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            openDetailModal(po);
          }}
          className="font-medium text-primary hover:underline whitespace-nowrap"
        >
          {po.poNumber}
        </button>
      ),
    },
    {
      key: 'supplier',
      label: 'ผู้ขาย',
      sortable: true,
      render: (po) => {
        const sameName =
          po.supplier.contactName &&
          po.supplier.contactName.trim().toLowerCase() === po.supplier.name.trim().toLowerCase();
        return (
          <div>
            <div className="font-medium">{po.supplier.name}</div>
            {po.supplier.contactName && !sameName && (
              <div className="text-xs text-muted-foreground">{po.supplier.contactName}</div>
            )}
          </div>
        );
      },
    },
    {
      key: 'orderDate',
      label: 'วันที่สั่ง',
      sortable: true,
      render: (po) => <span className="text-sm whitespace-nowrap">{formatDateShort(po.orderDate)}</span>,
    },
    {
      key: 'items',
      label: 'รายการ',
      sortable: true,
      render: (po) => <span className="text-sm">{po.items.length} รายการ</span>,
    },
    {
      key: 'totalAmount',
      label: 'ยอดรวม',
      sortable: true,
      render: (po) => (
        <div>
          <span className="text-sm font-medium whitespace-nowrap">
            {Number(po.netAmount ?? po.totalAmount).toLocaleString()} บาท
          </span>
          {Number(po.discount) > 0 && (
            <div className="text-xs text-destructive">ส่วนลดก่อน VAT -{Number(po.discount).toLocaleString()}</div>
          )}
          {Number(po.discountAfterVat) > 0 && (
            <div className="text-xs text-destructive">ส่วนลดหลัง VAT -{Number(po.discountAfterVat).toLocaleString()}</div>
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
      sortable: true,
      render: (po) => {
        const cfg = getStatusBadgeProps(po.status, poStatusMap);
        return (
          <Badge variant={cfg.variant} appearance={cfg.appearance}>
            {cfg.label}
          </Badge>
        );
      },
    },
    {
      key: 'paymentStatus',
      label: 'การจ่ายเงิน',
      sortable: true,
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
            <Badge variant={cfg.variant} appearance={cfg.appearance}>
              {cfg.label}
            </Badge>
          </button>
        );
      },
    },
    {
      key: 'received',
      label: 'รับสินค้า',
      render: (po) => {
        const totalOrdered = po.items.reduce((s, i) => s + i.quantity, 0);
        const totalReceived = po.items.reduce((s, i) => s + i.receivedQty, 0);
        return (
          <div className="flex items-center gap-2">
            <span className="text-sm whitespace-nowrap">
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
      hideable: false,
      render: (po) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => openDetailModal(po)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="ดูรายละเอียด"
            aria-label={`ดูรายละเอียด ${po.poNumber}`}
          >
            <FileText className="size-4" />
          </button>
          {['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status) && (
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
                onClick={() => {
                  setConfirmDialog({
                    open: true,
                    message: `อนุมัติ PO ${po.poNumber}?`,
                    action: () => approveMutation.mutate(po.id),
                  });
                }}
                disabled={approveMutation.isPending}
                className="p-1.5 rounded-md text-success hover:bg-success/10 transition-colors disabled:opacity-50"
                title="อนุมัติ"
                aria-label={`อนุมัติ ${po.poNumber}`}
              >
                <Check className="size-4" />
              </button>
              <button
                onClick={() => setRejectDialog({ open: true, po, reason: '' })}
                disabled={rejectPOMutation.isPending}
                className="p-1.5 rounded-md text-warning hover:bg-warning/10 transition-colors disabled:opacity-50"
                title="ปฏิเสธ"
                aria-label={`ปฏิเสธ ${po.poNumber}`}
              >
                <X className="size-4" />
              </button>
              <button
                onClick={() => {
                  setConfirmDialog({
                    open: true,
                    message: `ต้องการยกเลิก PO ${po.poNumber}?`,
                    action: () => cancelMutation.mutate(po.id),
                  });
                }}
                className="p-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors"
                title="ยกเลิก"
                aria-label={`ยกเลิก ${po.poNumber}`}
              >
                <Ban className="size-4" />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  const hasFilter = Boolean(search || statusFilter || supplierFilter || periodFilter);

  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="ค้นหาเลข PO, ผู้ขาย..."
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
          <option value="PARTIALLY_RECEIVED">รับบางส่วน</option>
          <option value="FULLY_RECEIVED">รับครบแล้ว</option>
          <option value="CANCELLED">ยกเลิก</option>
        </select>
        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm bg-background focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden max-w-[220px]"
        >
          <option value="">ทุกผู้ขาย</option>
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
                  PARTIALLY_RECEIVED: 'รับบางส่วน',
                  FULLY_RECEIVED: 'รับครบแล้ว',
                  CANCELLED: 'ยกเลิก',
                }[statusFilter] || statusFilter
              }`}
              onRemove={() => setStatusFilter('')}
            />
          )}
          {supplierFilter && (
            <FilterChip label={`ผู้ขาย: ${selectedSupplierName}`} onRemove={() => setSupplierFilter('')} />
          )}
          {periodFilter && (
            <FilterChip label={`ช่วงเวลา: ${selectedPeriodLabel}`} onRemove={() => setPeriodFilter('')} />
          )}
          <button
            onClick={clearAll}
            className="ml-1 text-xs text-muted-foreground hover:text-foreground underline"
          >
            ล้างทั้งหมด
          </button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={filteredPos}
            isLoading={isLoading}
            emptyMessage={hasFilter ? 'ไม่พบใบสั่งซื้อที่ตรงกับตัวกรอง' : 'ยังไม่มีใบสั่งซื้อ'}
            emptyIcon={hasFilter ? Search : undefined}
            emptyDescription={hasFilter ? 'ลองล้างตัวกรองหรือเปลี่ยนคำค้นหา' : undefined}
            columnToggle
            onRowClick={openDetailModal}
          />
        </CardContent>
      </Card>

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
