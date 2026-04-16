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

interface PaymentTableProps {
  pendingPayments: PendingPayment[];
  loadingPending: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onOpenPayModal: (payment: PendingPayment) => void;
  onOpenAdvanceModal: (payment: PendingPayment) => void;
  onViewHistory: (contractId: string) => void;
  batchTotal: number;
  onShowBatchModal: () => void;
  onClearSelection: () => void;
}

export default function PaymentTable({
  pendingPayments,
  loadingPending,
  selectedIds,
  onToggleSelect,
  onOpenPayModal,
  onOpenAdvanceModal,
  onViewHistory,
  batchTotal,
  onShowBatchModal,
  onClearSelection,
}: PaymentTableProps) {
  const { copy } = useCopyToClipboard();
  const pendingColumns = useMemo(() => [
    {
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
    },
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
      const isOverdue = new Date(p.dueDate) < new Date();
      return <span className={`text-sm ${isOverdue ? 'text-destructive font-medium' : ''}`}>{formatDateShort(p.dueDate)}</span>;
    }},
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
        const cfg = getStatusBadgeProps(p.status, paymentStatusMap);
        return <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{cfg.label}</Badge>;
      },
    },
    { key: 'branch', label: 'สาขา', render: (p: PendingPayment) => <span className="text-xs">{p.contract.branch.name}</span> },
    {
      key: 'actions',
      label: '',
      render: (p: PendingPayment) => (
        <div className="flex gap-1">
          <button onClick={() => onOpenPayModal(p)} className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">
            รับชำระ
          </button>
          <button onClick={() => onOpenAdvanceModal(p)} className="px-2 py-1 text-xs border border-primary text-primary rounded hover:bg-primary/10">
            ล่วงหน้า
          </button>
          <button onClick={() => onViewHistory(p.contract.id)} className="px-2 py-1 text-xs border border-muted-foreground/30 text-muted-foreground rounded hover:bg-muted">
            ประวัติ
          </button>
        </div>
      ),
    },
  ], [onOpenPayModal, onOpenAdvanceModal, onViewHistory, selectedIds, onToggleSelect, copy]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>รายการรอชำระ</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingPending ? (
            <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
          ) : (
            <DataTable columns={pendingColumns} data={pendingPayments} emptyMessage="ไม่มีรายการรอชำระ" />
          )}
        </CardContent>
      </Card>

      {/* Batch action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-6 py-3 rounded-xl shadow-lg flex items-center gap-4 z-50">
          <span className="text-sm font-medium">เลือก {selectedIds.size} รายการ ({Math.round(batchTotal).toLocaleString()} ฿)</span>
          <button onClick={onShowBatchModal} className="px-4 py-1.5 bg-card text-primary rounded-lg text-sm font-medium hover:bg-card/90">
            รับชำระรวม
          </button>
          <button onClick={onClearSelection} className="text-xs text-white/70 hover:text-white">ยกเลิก</button>
        </div>
      )}
    </>
  );
}
