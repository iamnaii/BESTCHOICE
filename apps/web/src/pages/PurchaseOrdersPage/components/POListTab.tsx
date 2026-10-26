import { useMemo, useState } from 'react';
import { UseMutationResult } from '@tanstack/react-query';
import DataTable, { Column } from '@/components/ui/DataTable';
import { formatDateShort } from '@/utils/formatters';
import { useDebounce } from '@/hooks/useDebounce';
import { useIsMobile } from '@/hooks/useIsMobile';
import { CancelPOPayload, PurchaseOrder, ApprovePOPayload } from '../types';
import { ApprovePODialog } from './ApprovePODialog';
import type { SupplierPaymentMethod } from './wizard/PaymentSection';
import { cn } from '@/lib/utils';
import { receiveProgress, isOverdue, supplierContactIsRedundant, canCancel, isClosedShort, splitLeadingTag, pieceCount, itemsSummary } from '../po-list.util';
import { statusLabels } from '../constants';
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
import { Input } from '@/components/ui/input';
import { formControlClass } from '@/components/ui/form-styles';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
  cancelMutation: UseMutationResult<unknown, unknown, { id: string; payload?: CancelPOPayload }, unknown>;
  /** ก้อน 2: เปิดกล่องยกเลิกที่ถามผลมัดจำ (ถ้ามี) แทน confirm ธรรมดา */
  onCancelPO?: (po: PurchaseOrder) => void;
  setConfirmDialog: (value: { open: boolean; message: string; action: () => void }) => void;
  suppliers: { id: string; name: string; hasVat?: boolean; paymentMethods?: SupplierPaymentMethod[] }[];
  overdueOnly: boolean;
  setOverdueOnly: (value: boolean) => void;
  /** ดูอย่างเดียว (ผจก.การเงิน / ฝ่ายบัญชี) — ซ่อนปุ่มกระทำทั้งตารางและการ์ด เหลือ "ดูรายละเอียด" */
  readOnly?: boolean;
  /** อนุมัติ/ปฏิเสธใบรออนุมัติ = เจ้าของกิจการเท่านั้น (`POST :id/approve` / `:id/reject` @Roles('OWNER')) — ผจก.สาขาเห็นใบตัวเองแต่กดไม่ได้ */
  canApprove?: boolean;
}

const periodOptions: { value: PeriodFilter; label: string }[] = [
  { value: '', label: 'ทุกช่วงเวลา' },
  { value: 'this-month', label: 'เดือนนี้' },
  { value: 'last-month', label: 'เดือนที่แล้ว' },
  { value: 'this-quarter', label: 'ไตรมาสนี้' },
  { value: 'this-year', label: 'ปีนี้' },
];

const filterControlClass = cn(formControlClass, 'shadow-none');
const allFilterValue = '__all__';

function FilterSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value || allFilterValue} onValueChange={(next) => onChange(next === allFilterValue ? '' : next)}>
      <SelectTrigger
        aria-label={label}
        className={cn(filterControlClass, 'gap-2 [&>span]:min-w-0 [&>span]:text-left [&>svg]:mr-0 [&>svg]:shrink-0')}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        align="start"
        collisionPadding={12}
        className="max-h-[min(20rem,var(--radix-select-content-available-height))] w-(--radix-select-trigger-width) min-w-0 [&_[data-radix-select-viewport]]:min-w-0"
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value || allFilterValue}
            className="min-h-11 cursor-pointer leading-normal [&>span:last-child]:min-w-0 [&>span:last-child]:whitespace-normal [&>span:last-child]:break-words"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

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
  onCancelPO,
  readOnly = false,
  canApprove = true,
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
    onCancelPO
      ? onCancelPO(po)
      : setConfirmDialog({
          open: true,
          message:
            po.status === 'ORDERED'
              ? `ต้องการยกเลิก PO ${po.poNumber}? สั่งซื้อแล้วแต่ยังไม่ได้รับของ — ยกเลิกแล้วต้องแจ้งผู้ขายเอง`
              : `ต้องการยกเลิก PO ${po.poNumber}?`,
          action: () => cancelMutation.mutate({ id: po.id }),
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
      width: '12rem',
      render: (po) => (
        <div>
          <button
            data-po-detail-trigger={`${po.id}:number`}
            onClick={(e) => {
              e.stopPropagation();
              openDetailModal(po);
            }}
            className="max-w-full text-left font-mono font-semibold text-primary hover:underline [overflow-wrap:anywhere]"
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
          <div className="min-w-0 max-w-52">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 break-words font-medium" title={po.supplier.name}>
                {name}
              </span>
              {tag && (
                <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] leading-[18px] font-medium whitespace-nowrap text-muted-foreground">
                  {tag}
                </span>
              )}
            </div>
            {po.supplier.contactName && !sameName && (
              <div className="mt-0.5 break-words text-xs text-muted-foreground">{po.supplier.contactName}</div>
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
        const badge = (
          <Badge variant={cfg.variant} appearance={cfg.appearance} className="whitespace-nowrap">
            {cfg.label}
          </Badge>
        );
        // ดูอย่างเดียว: ป้ายเฉย ๆ — POST :id/payments เป็นของ OWNER/BM (การ์ดมือถือก็เป็นป้ายอยู่แล้ว)
        if (readOnly) return badge;
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              openPaymentModal(po);
            }}
            className="cursor-pointer hover:opacity-80"
            title="บันทึกการจ่าย"
          >
            {badge}
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
        // ปิดใบ รับไม่ครบ: "รับแล้ว 3/5 (ปิด 2)" — ชิ้นที่ไม่รับแล้วไม่ใช่ของที่กำลังมา
        const closedShort = isClosedShort(po);
        return (
          <div className="flex items-center gap-2.5">
            <span className="text-sm whitespace-nowrap tabular-nums leading-snug">
              <span className={cn('font-mono font-semibold', done && 'text-success')}>{received}</span>
              <span className="text-muted-foreground">/{ordered}</span>
              {closedShort && ordered > received && (
                <span className="ml-1 text-xs text-warning-strong">(ปิด {ordered - received})</span>
              )}
            </span>
            {ordered > 0 && (
              <div className="h-1.5 flex-1 rounded-full bg-muted">
                <div className={cn('h-1.5 rounded-full', done ? 'bg-success' : closedShort ? 'bg-warning' : 'bg-primary')} style={{ width: `${pct}%` }} />
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
      width: '10rem',
      align: 'right',
      stickyRight: true,
      render: (po) => (
        <div className="flex flex-wrap items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <button data-ui-control="button" data-ui-icon="true"
            data-po-detail-trigger={`${po.id}:detail`}
            onClick={() => openDetailModal(po)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="ดูรายละเอียด"
            aria-label={`ดูรายละเอียด ${po.poNumber}`}
          >
            <FileText className="size-4" />
          </button>
          {!readOnly && po.status === 'APPROVED' && (
            <button data-ui-control="button" data-ui-icon="true"
              onClick={() => onOrder(po)}
              disabled={orderMutation.isPending}
              className="p-1.5 rounded-md text-info hover:bg-info/10 transition-colors disabled:opacity-50"
              title="สั่งซื้อ"
              aria-label={`สั่งซื้อ ${po.poNumber}`}
            >
              <ShoppingCart className="size-4" />
            </button>
          )}
          {!readOnly && ['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status) && (
            <button data-ui-control="button" data-ui-icon="true"
              onClick={() => openReceiveModal(po)}
              className="p-1.5 rounded-md text-primary hover:bg-primary/10 transition-colors"
              title="รับสินค้า"
              aria-label={`รับสินค้า ${po.poNumber}`}
            >
              <PackageCheck className="size-4" />
            </button>
          )}
          {!readOnly && canApprove && po.status === 'DRAFT' && (
            <>
              <button data-ui-control="button" data-ui-icon="true"
                onClick={() => onApprove(po)}
                disabled={approveMutation.isPending}
                className="p-1.5 rounded-md text-success hover:bg-success/10 transition-colors disabled:opacity-50"
                title="อนุมัติ"
                aria-label={`อนุมัติ ${po.poNumber}`}
              >
                <Check className="size-4" />
              </button>
              <button data-ui-control="button" data-ui-icon="true"
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
          {!readOnly && canCancel(po) && (
            <button data-ui-control="button" data-ui-icon="true"
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
    : readOnly
      ? 'ใบสั่งซื้อสร้างโดยเจ้าของกิจการหรือผู้จัดการสาขา — เมื่อมีใบแล้วจะแสดงที่นี่'
      : 'กด "+ ซื้อสินค้า" ที่มุมขวาบนเพื่อเริ่มสั่งซื้อสินค้าจากผู้จัดจำหน่าย';

  return (
    <>
      {/* Filters */}
      <div className="mb-4 grid grid-cols-1 items-center gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <Input aria-label="ค้นหาเลข PO, ผู้จัดจำหน่าย"
          type="text"
          placeholder="ค้นหาเลข PO, ผู้จัดจำหน่าย..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={filterControlClass}
        />
        <FilterSelect label="สถานะ"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: '', label: 'ทุกสถานะ' },
            { value: 'DRAFT', label: 'รออนุมัติ' },
            { value: 'APPROVED', label: 'อนุมัติแล้ว' },
            { value: 'ORDERED', label: 'สั่งซื้อแล้ว' },
            { value: 'PARTIALLY_RECEIVED', label: 'รับบางส่วน' },
            { value: 'FULLY_RECEIVED', label: 'รับครบแล้ว' },
            { value: 'CLOSED_SHORT', label: 'ปิดใบ รับไม่ครบ' },
            { value: 'CANCELLED', label: 'ยกเลิก' },
          ]}
        />
        <FilterSelect label="ผู้จัดจำหน่าย"
          value={supplierFilter}
          onChange={setSupplierFilter}
          options={[{ value: '', label: 'ทุกผู้จัดจำหน่าย' }, ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))]}
        />
        <FilterSelect label="ช่วงเวลา"
          value={periodFilter}
          onChange={(value) => setPeriodFilter(value as PeriodFilter)}
          options={periodOptions}
        />
      </div>

      {/* Active filter chips */}
      {hasFilter && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-muted-foreground">ตัวกรองที่ใช้:</span>
          {search && <FilterChip label={`ค้นหา: "${search}"`} onRemove={() => setSearch('')} />}
          {statusFilter && (
            <FilterChip
              label={`สถานะ: ${statusLabels[statusFilter] || statusFilter}`}
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
                onApprove={onApprove}
                onOrder={onOrder}
                onReject={onReject}
                onCancel={onCancel}
                approvePending={approveMutation.isPending}
                orderPending={orderMutation.isPending}
                rejectPending={rejectPOMutation.isPending}
                readOnly={readOnly}
                canApprove={canApprove}
              />
            ))}
          </div>
        )
      ) : (
        <Card>
          <CardContent className="p-0">
            <DataTable embedded
              columns={columns}
              data={filteredPos}
              isLoading={isLoading}
              emptyMessage={emptyTitle}
              emptyIcon={EmptyIcon}
              emptyDescription={emptyDesc}
              columnToggle
              onRowClick={openDetailModal}
              // Keep space for the supplier beside fixed columns; scale with larger root text.
              // Narrow desktop layouts scroll inside the table while actions stay pinned.
              minWidth="80rem"
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
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
      <span className="min-w-0 break-words">{label}</span>
      <button
        onClick={onRemove}
        className="shrink-0 hover:bg-primary/20 rounded-full p-0.5 transition-colors"
        aria-label={`ลบ ${label}`}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
