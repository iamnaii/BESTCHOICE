import { Card, CardContent } from '@/components/ui/card';
import DataTable from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getStatusBadgeProps, stockAdjustmentReasonMap, stockAdjustmentStatusMap } from '@/lib/status-badges';
import { formatDateShort, formatDateTime } from '@/utils/formatters';
import type { CurrentActor, StockAdjustmentRow } from '../types';
import { canCancel, canDecide, formatBaht, productStatusLabel } from '../stock-adjustment.util';

interface Props {
  rows: StockAdjustmentRow[];
  isLoading: boolean;
  user: CurrentActor;
  onOpen: (row: StockAdjustmentRow) => void;
  emptyMessage: string;
}

export default function AdjustmentTable({ rows, isLoading, user, onOpen, emptyMessage }: Props) {
  const columns = [
    {
      key: 'requestNumber',
      label: 'คำขอ',
      render: (a: StockAdjustmentRow) => (
        <div>
          <div className="font-mono text-sm">{a.requestNumber ?? '-'}</div>
          <div className="text-xs text-muted-foreground" title={formatDateTime(a.createdAt)}>
            {formatDateShort(a.createdAt)}
          </div>
        </div>
      ),
    },
    {
      key: 'product',
      label: 'เครื่อง',
      render: (a: StockAdjustmentRow) => (
        <div className="min-w-0">
          <div className="font-medium text-sm leading-snug">
            {a.product.brand} {a.product.model}
          </div>
          {a.product.imeiSerial && <div className="text-xs text-muted-foreground font-mono">{a.product.imeiSerial}</div>}
          <div className="text-xs text-muted-foreground leading-snug">{a.branch.name}</div>
        </div>
      ),
    },
    {
      key: 'reason',
      label: 'เหตุผล',
      render: (a: StockAdjustmentRow) => {
        const cfg = getStatusBadgeProps(a.reason, stockAdjustmentReasonMap);
        return (
          <div>
            <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
              {cfg.label}
            </Badge>
            <div className="text-xs text-muted-foreground leading-snug mt-0.5">จาก {productStatusLabel(a.previousStatus)}</div>
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (a: StockAdjustmentRow) => {
        const cfg = getStatusBadgeProps(a.status, stockAdjustmentStatusMap);
        return (
          <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
            {cfg.label}
          </Badge>
        );
      },
    },
    {
      key: 'cost',
      label: 'ต้นทุน',
      render: (a: StockAdjustmentRow) => <span className="text-sm font-mono tabular-nums">{formatBaht(a.costAmount ?? a.product.costPrice)}</span>,
    },
    {
      key: 'journal',
      label: 'บัญชี',
      render: (a: StockAdjustmentRow) =>
        a.journalEntryNo ? (
          <span className="text-xs font-mono">{a.journalEntryNo}</span>
        ) : a.status === 'APPROVED' && a.inventoryBooked === false ? (
          <span className="text-xs text-warning-strong leading-snug">ไม่มี JE · แจ้งบัญชีแล้ว</span>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        ),
    },
    {
      key: 'adjustedBy',
      label: 'ผู้ขอ',
      render: (a: StockAdjustmentRow) => <span className="text-xs text-muted-foreground">{a.adjustedBy.name}</span>,
    },
    {
      key: 'actions',
      label: '',
      render: (a: StockAdjustmentRow) => (
        <div className="flex justify-end gap-1">
          {canDecide(a, user) ? (
            <Button size="sm" onClick={() => onOpen(a)}>
              พิจารณา
            </Button>
          ) : canCancel(a, user) ? (
            <Button size="sm" variant="outline" onClick={() => onOpen(a)}>
              ยกเลิกคำขอ
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => onOpen(a)}>
              ดู
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardContent className="p-0">
        <DataTable columns={columns} data={rows} isLoading={isLoading} emptyMessage={emptyMessage} onRowClick={onOpen} />
      </CardContent>
    </Card>
  );
}
