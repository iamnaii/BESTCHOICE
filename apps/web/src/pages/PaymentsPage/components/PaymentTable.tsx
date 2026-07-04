import { useMemo } from 'react';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import DataTable from '@/components/ui/DataTable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  const pendingColumns = useMemo(() => [
    // ชำระครบ tab is read-only — no batch selection.
    ...(isPaidMode ? [] : [{
      key: 'select',
      label: '',
      render: (p: PendingPayment) => (
        <input
          type="checkbox"
          checked={selectedIds.has(p.id)}
          onChange={() => onToggleSelect(p.id)}
          className="rounded border-input"
          aria-label={`เลือกงวดที่ ${p.installmentNo} ของสัญญา ${p.contract.contractNumber}`}
        />
      ),
    }]),
    {
      key: 'contract',
      label: 'สัญญา',
      render: (p: PendingPayment) => (
        <div>
          <div className="flex items-center gap-1">
            <span className="font-mono text-sm text-primary">{p.contract.contractNumber}</span>
            <button
              onClick={(e) => { e.stopPropagation(); copy(p.contract.contractNumber); toast.success('คัดลอกแล้ว'); }}
              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label={`คัดลอกเลขที่สัญญา ${p.contract.contractNumber}`}
            >
              <Copy className="size-3" />
            </button>
          </div>
          <div className="text-xs text-muted-foreground">{p.contract.customer.name}</div>
        </div>
      ),
    },
    { key: 'installmentNo', label: 'งวดที่', render: (p: PendingPayment) => <span className="font-medium">{p.installmentNo}</span> },
    { key: 'dueDate', label: 'วันครบกำหนด', render: (p: PendingPayment) => {
      // A settled installment is never "overdue" — the red flag is pending-only.
      const isOverdue = !isPaidMode && new Date(p.dueDate) < new Date();
      return <span className={`text-sm ${isOverdue ? 'text-destructive font-medium' : ''}`}>{formatDateShort(p.dueDate)}</span>;
    }},
    ...(isPaidMode ? [{
      key: 'paidDate',
      label: 'วันที่ชำระ',
      render: (p: PendingPayment) =>
        p.paidDate
          ? <span className="text-sm text-success font-medium">{formatDateShort(p.paidDate)}</span>
          : <span className="text-xs text-muted-foreground">-</span>,
    }] : []),
    { key: 'amountDue', label: 'ยอดที่ต้องชำระ', render: (p: PendingPayment) => {
      const total = parseFloat(p.amountDue) + parseFloat(p.lateFee);
      return <span className="text-sm font-medium">{total.toLocaleString()} ฿</span>;
    }},
    { key: 'amountPaid', label: 'ชำระแล้ว', render: (p: PendingPayment) => {
      const paid = parseFloat(p.amountPaid);
      return paid > 0 ? <span className="text-sm text-success">{paid.toLocaleString()} ฿</span> : <span className="text-xs text-muted-foreground">-</span>;
    }},
    { key: 'lateFee', label: 'ค่าปรับ', render: (p: PendingPayment) => {
      const fee = parseFloat(p.lateFee);
      return fee > 0 ? <span className="text-sm text-destructive">{fee.toLocaleString()} ฿</span> : <span className="text-xs text-muted-foreground">-</span>;
    }},
    {
      key: 'status',
      label: 'สถานะ',
      render: (p: PendingPayment) => {
        let mainBadge: React.ReactNode;
        if (p.status === 'PARTIALLY_PAID') {
          const owed = (parseFloat(p.amountDue) + parseFloat(p.lateFee)) - parseFloat(p.amountPaid);
          mainBadge = (
            <Badge variant="warning" appearance="default" size="md">
              ค้าง {owed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿
            </Badge>
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
          <div className="flex flex-col gap-1 items-start">
            {mainBadge}
            {closedEarly && <Badge variant="secondary" appearance="outline" size="sm">ปิดยอดก่อนกำหนด</Badge>}
            {usedCredit && <Badge variant="secondary" appearance="outline" size="sm">หักจากเครดิตล่วงหน้า</Badge>}
            {/* Active partial-payment QR (cashier sent QR earlier, awaiting customer scan) */}
            {p.status !== 'PAID' && <QrSentBadge paymentId={p.id} />}
          </div>
        );
      },
    },
    { key: 'branch', label: 'สาขา', render: (p: PendingPayment) => <span className="text-xs">{p.contract.branch.name}</span> },
    {
      key: 'actions',
      label: '',
      render: (p: PendingPayment) => (
        <div className="flex gap-1">
          {!isPaidMode && (
            <button onClick={() => onOpenPayModal(p)} className="px-2 py-1 text-xs bg-success text-success-foreground rounded hover:bg-success/90">
              รับชำระ
            </button>
          )}
          <button onClick={() => onViewHistory(p.contract.id)} className="px-2 py-1 text-xs border border-muted-foreground/30 text-muted-foreground rounded hover:bg-muted">
            ประวัติ
          </button>
        </div>
      ),
    },
  ], [onOpenPayModal, onViewHistory, selectedIds, onToggleSelect, copy, isPaidMode]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{isPaidMode ? 'รายการชำระครบ' : 'รายการรอชำระ'}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingPending ? (
            <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
          ) : (
            <DataTable columns={pendingColumns} data={pendingPayments} emptyMessage={isPaidMode ? 'ไม่มีรายการชำระครบในช่วงที่เลือก' : 'ไม่มีรายการรอชำระ'} />
          )}
        </CardContent>
      </Card>

      {/* Batch action bar */}
      {!isPaidMode && selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-6 py-3 rounded-xl shadow-lg flex items-center gap-4 z-50">
          <span className="text-sm font-medium">เลือก {selectedIds.size} รายการ ({Math.round(batchTotal).toLocaleString()} ฿)</span>
          <button onClick={onShowBatchModal} className="px-4 py-1.5 bg-card text-primary rounded-lg text-sm font-medium hover:bg-card/90">
            รับชำระรวม
          </button>
          <button onClick={onClearSelection} className="text-xs text-primary-foreground/70 hover:text-primary-foreground">ยกเลิก</button>
        </div>
      )}
    </>
  );
}
