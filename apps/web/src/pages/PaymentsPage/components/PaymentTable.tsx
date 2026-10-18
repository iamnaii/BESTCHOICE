import { useMemo } from 'react';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import DataTable, { type Column } from '@/components/ui/DataTable';
import { revealTableControl } from '@/components/ui/table-focus';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateShort } from '@/utils/formatters';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import type { PendingPayment } from '../types';
import { getStatusBadgeProps, paymentStatusMap } from '@/lib/status-badges';
import { QrSentBadge } from './QrSentBadge';

interface PaymentTableProps {
  pendingPayments: PendingPayment[];
  loadingPending: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onOpenPayModal: (payment: PendingPayment) => void;
  onViewHistory: (contractId: string) => void;
  batchTotal: number;
  onShowBatchModal: () => void;
  onClearSelection: () => void;
  /** 'paid' = ชำระครบ tab — read-only rows: no checkbox/batch/รับชำระ, shows paidDate. */
  mode?: 'pending' | 'paid';
}

export default function PaymentTable({
  pendingPayments,
  loadingPending,
  selectedIds,
  onToggleSelect,
  onOpenPayModal,
  onViewHistory,
  batchTotal,
  onShowBatchModal,
  onClearSelection,
  mode = 'pending',
}: PaymentTableProps) {
  const { copy } = useCopyToClipboard();
  const isPaidMode = mode === 'paid';
  const pendingColumns = useMemo<Column<PendingPayment>[]>(() => [
    {
      key: 'contract',
      label: 'ลูกค้า / สัญญา',
      render: (p: PendingPayment) => (
        <div className="flex max-w-72 items-start gap-2">
          {!isPaidMode && (
        <label className="inline-flex size-11 shrink-0 items-center justify-center">
          <input
            type="checkbox"
            checked={selectedIds.has(p.id)}
            // ห้ามข้ามงวด — batch would post this row out of order and the server
            // would reject it row-by-row; keep it unselectable instead. Guarded in
            // the handler too, not just `disabled` (assistive tech / synthetic
            // events can still dispatch change on a disabled input in some DOMs).
            onChange={() => {
              if (p.hasEarlierUnpaid !== true) onToggleSelect(p.id);
            }}
            disabled={p.hasEarlierUnpaid === true}
            className="size-4 cursor-pointer rounded border-input accent-primary disabled:opacity-40 disabled:cursor-not-allowed"
            title={p.hasEarlierUnpaid ? 'ต้องชำระตามลำดับงวด — มีงวดก่อนหน้าค้างอยู่' : undefined}
            aria-label={`เลือกงวดที่ ${p.installmentNo} ของสัญญา ${p.contract.contractNumber}`}
          />
        </label>
          )}
          <div className="min-w-0 space-y-1 leading-snug [overflow-wrap:anywhere]">
          <div className="break-words text-sm font-medium">{p.contract.customer.name}</div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              mode="icon"
              size="sm"
              onClick={(e) => { e.stopPropagation(); copy(p.contract.contractNumber); toast.success('คัดลอกแล้ว'); }}
              aria-label={`คัดลอกเลขที่สัญญา ${p.contract.contractNumber}`}
            >
              <Copy className="size-3.5" />
            </Button>
            <span className="min-w-0 break-words text-xs text-primary">{p.contract.contractNumber}</span>
          </div>
          <div className="break-words text-xs text-muted-foreground">สาขา {p.contract.branch.name}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'dueDate', label: isPaidMode ? 'วันที่ชำระ' : 'กำหนดชำระ',
      className: 'whitespace-nowrap tabular-nums',
      render: (p: PendingPayment) => {
        const isOverdue = !isPaidMode && new Date(p.dueDate) < new Date();
        return <div className="space-y-1">
          <div className={`text-sm ${isPaidMode ? 'text-success' : isOverdue ? 'text-destructive font-medium' : ''}`}>
            {isPaidMode ? p.paidDate ? formatDateShort(p.paidDate) : '-' : formatDateShort(p.dueDate)}
          </div>
          <div className="text-xs text-muted-foreground">งวดที่ {p.installmentNo}</div>
          {isPaidMode && <div className="text-xs text-muted-foreground">
            กำหนด {formatDateShort(p.dueDate)}
          </div>}
        </div>;
      },
    },
    {
      key: 'amountDue', label: 'ยอดรวม', align: 'right',
      className: 'whitespace-nowrap tabular-nums',
      render: (p: PendingPayment) => {
        const total = parseFloat(p.amountDue) + parseFloat(p.lateFee);
        return <span className="text-sm font-semibold">{total.toLocaleString()} ฿</span>;
      },
    },
    {
      key: 'amountPaid', label: 'ชำระแล้ว', align: 'right',
      className: 'whitespace-nowrap tabular-nums',
      render: (p: PendingPayment) => {
        // Settled rows show receipt cash, not the installment's booked settlement.
        const paid = isPaidMode
          ? p.receiptCashAmount == null ? null : Number(p.receiptCashAmount)
          : Number(p.amountPaid);
        return paid === null ? <span title="ไม่พบข้อมูลยอดรับจากใบเสร็จ">–</span>
          : paid > 0 || isPaidMode ? <span className="text-success">{paid.toLocaleString()} ฿</span>
          : <span className="text-muted-foreground">-</span>;
      },
    },
    {
      key: 'lateFee', label: 'ค่าปรับ', align: 'right',
      className: 'whitespace-nowrap tabular-nums',
      render: (p: PendingPayment) => {
        const fee = parseFloat(p.lateFee);
        return fee > 0 ? <span className="text-destructive">{fee.toLocaleString()} ฿</span>
          : <span className="text-muted-foreground">-</span>;
      },
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (p: PendingPayment) => {
        let mainBadge: React.ReactNode;
        if (p.status === 'PARTIALLY_PAID') {
          const owed = (parseFloat(p.amountDue) + parseFloat(p.lateFee)) - parseFloat(p.amountPaid);
          mainBadge = (
            <div className="space-y-1">
              <Badge variant="warning" appearance="light" size="sm">ชำระบางส่วน</Badge>
              <div className="text-xs text-warning-strong">
                ค้าง <span className="whitespace-nowrap tabular-nums">{owed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿</span>
              </div>
            </div>
          );
        } else {
          const cfg = getStatusBadgeProps(p.status, paymentStatusMap);
          mainBadge = <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{cfg.label}</Badge>;
        }
        // Settlement-method stamps (paid mode): explain why ชำระแล้ว can be
        // partial or '-' on a PAID row — the record flows stamp notes with
        // '[ปิดก่อนกำหนด]' (early payoff, discount closes the rest) and
        // 'ใช้เครดิต X บาท' (advance credit consumed, no new cash on this row).
        const closedEarly = isPaidMode && p.notes?.includes('ปิดก่อนกำหนด');
        const usedCredit = isPaidMode && p.notes?.includes('ใช้เครดิต');
        return (
          <div className="flex min-w-0 flex-col items-start gap-1 leading-snug [&_[data-slot=badge]]:h-auto [&_[data-slot=badge]]:max-w-full [&_[data-slot=badge]]:whitespace-normal [&_[data-slot=badge]]:py-1">
            {mainBadge}
            {closedEarly && <Badge variant="secondary" appearance="outline" size="sm">ปิดยอดก่อนกำหนด</Badge>}
            {usedCredit && <Badge variant="secondary" appearance="outline" size="sm">หักจากเครดิตล่วงหน้า</Badge>}
            {/* Active partial-payment QR (cashier sent QR earlier, awaiting customer scan) */}
            {p.status !== 'PAID' && <QrSentBadge paymentId={p.id} />}
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: 'จัดการ',
      stickyRight: true,
      align: 'right',
      render: (p: PendingPayment) => (
        <div className="flex flex-col items-stretch justify-end gap-2 sm:flex-row sm:items-center">
          {!isPaidMode && (
            <Button
              type="button"
              onClick={() => onOpenPayModal(p)}
              // ห้ามข้ามงวด (2026-08-19): recording is only allowed on the
              // contract's earliest unpaid installment — the orchestrator
              // enforces this server-side; the disabled button explains it
              // before the cashier hits the error.
              disabled={p.hasEarlierUnpaid === true}
              className="disabled:pointer-events-auto disabled:cursor-not-allowed"
              title={
                p.hasEarlierUnpaid
                  ? 'ต้องชำระตามลำดับงวด — มีงวดก่อนหน้าค้างอยู่ (ข้ามงวดไม่ได้)'
                  : undefined
              }
            >
              รับชำระ
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onViewHistory(p.contract.id)}>
            ประวัติ
          </Button>
        </div>
      ),
    },
  ], [onOpenPayModal, onViewHistory, selectedIds, onToggleSelect, copy, isPaidMode]);

  return (
    <>
      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{isPaidMode ? 'รายการชำระครบ' : 'รายการรอชำระ'}</CardTitle>
          <p className="text-xs text-muted-foreground">ยอดรวมนี้รวมค่าปรับแล้ว</p>
        </CardHeader>
        <CardContent
          className="p-0"
          onFocusCapture={revealTableControl}
        >
          {loadingPending ? (
            <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
          ) : (
            <DataTable
              columns={pendingColumns}
              data={pendingPayments}
              density="compact"
              responsive={false}
              minWidth="54rem"
              scrollLabel={isPaidMode ? 'ตารางรายการชำระครบ' : 'ตารางรายการรอชำระ'}
              className="rounded-none border-0 shadow-none [&_th]:text-[13px] [&_th]:tracking-normal [&_th]:whitespace-nowrap [&_td]:text-sm [&_:is(button,input)]:scroll-mt-20 [&_:is(button,input)]:scroll-mb-[calc(5rem+env(safe-area-inset-bottom))]"
              emptyMessage={isPaidMode ? 'ไม่มีรายการชำระครบในช่วงที่เลือก' : 'ไม่มีรายการรอชำระ'}
            />
          )}
        </CardContent>
      </Card>

      {/* Batch action bar */}
      {!isPaidMode && selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 z-50 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-primary-foreground shadow-lg sm:gap-4">
          <span className="w-full text-center text-sm font-medium leading-snug sm:w-auto">เลือก {selectedIds.size} รายการ ({Math.round(batchTotal).toLocaleString()} ฿)</span>
          <Button type="button" onClick={onShowBatchModal} className="bg-card text-primary hover:bg-card/90">
            รับชำระรวม
          </Button>
          <Button type="button" variant="ghost" onClick={onClearSelection} className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">ยกเลิก</Button>
        </div>
      )}
    </>
  );
}
