import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import DataTable, { type Column } from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent } from '@/components/ui/card';
import { getStatusBadgeProps, tradeInStatusMap } from '@/lib/status-badges';
import { formatThaiDate } from '@/lib/date';
import { RefreshCw, CheckCircle, XCircle, FileText } from 'lucide-react';
import type { TradeIn } from '../types';

interface TradeInTableProps {
  data: TradeIn[] | undefined;
  total: number | undefined;
  page: number;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  canManage: boolean;
  onRefetch: () => void;
  onPageChange: (page: number) => void;
  onAppraise: (item: TradeIn) => void;
  onAccept: (item: TradeIn) => void;
  onReject: (id: string) => void;
  onVoucher: (item: TradeIn) => void;
  isRejectPending: boolean;
  isVoucherPending: boolean;
}

export default function TradeInTable({
  data,
  total,
  page,
  isLoading,
  isError,
  error,
  canManage,
  onRefetch,
  onPageChange,
  onAppraise,
  onAccept,
  onReject,
  onVoucher,
  isRejectPending,
  isVoucherPending,
}: TradeInTableProps) {
  const columns: Column<TradeIn>[] = [
    {
      key: 'customer',
      label: 'ผู้ขาย',
      sortable: true,
      render: (item) => (
        <div>
          <div className="font-medium text-foreground">
            {item.customer?.name || item.sellerName || '-'}
          </div>
          {!item.customer && item.sellerPhone && (
            <div className="text-xs text-muted-foreground">{item.sellerPhone}</div>
          )}
          {!item.customer && (
            <Badge variant="outline" className="mt-0.5 text-[10px]">
              walk-in
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'device',
      label: 'อุปกรณ์',
      render: (item) => (
        <span>
          {item.deviceBrand} {item.deviceModel}
          {item.deviceStorage && (
            <span className="text-muted-foreground ml-1">({item.deviceStorage})</span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (item) => {
        const cfg = getStatusBadgeProps(item.status, tradeInStatusMap);
        return (
          <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
            {cfg.label}
          </Badge>
        );
      },
    },
    {
      key: 'estimatedValue',
      label: 'ราคา',
      sortable: true,
      render: (item) => {
        const value = item.agreedPrice ?? item.offeredPrice ?? item.estimatedValue;
        return value != null ? (
          <span className="font-medium">฿{Number(value).toLocaleString()}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      },
    },
    {
      key: 'createdAt',
      label: 'วันที่',
      sortable: true,
      render: (item) => formatThaiDate(item.createdAt),
    },
    {
      key: 'actions',
      label: '',
      render: (item) => (
        <div className="flex items-center gap-1">
          {item.status === 'PENDING_APPRAISAL' && canManage && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onAppraise(item);
              }}
            >
              ประเมิน
            </Button>
          )}
          {item.status === 'APPRAISED' && canManage && (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={(e) => {
                  e.stopPropagation();
                  onAccept(item);
                }}
              >
                <CheckCircle className="size-3.5 mr-1" />
                ยอมรับ
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onReject(item.id);
                }}
                disabled={isRejectPending}
              >
                <XCircle className="size-3.5 mr-1" />
                ปฏิเสธ
              </Button>
            </>
          )}
          {(item.status === 'ACCEPTED' || item.status === 'COMPLETED') && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onVoucher(item);
              }}
              disabled={isVoucherPending}
            >
              <FileText className="size-3.5 mr-1" />
              {item.voucherNumber ? 'พิมพ์ใบสำคัญ' : 'ออกใบสำคัญ'}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardContent className="p-0">
        <QueryBoundary
          isLoading={isLoading && !data}
          isError={isError}
          error={error}
          onRetry={onRefetch}
          errorTitle="ไม่สามารถโหลดรายการรับซื้อได้"
        >
          <DataTable
            columns={columns}
            data={data || []}
            isLoading={isLoading}
            emptyMessage="ไม่พบรายการรับซื้อ"
            emptyIcon={RefreshCw}
            searchable
            searchPlaceholder="ค้นหาลูกค้า, ยี่ห้อ, รุ่น..."
            pagination={
              total !== undefined
                ? {
                    page,
                    totalPages: Math.ceil(total / 50),
                    total,
                    onPageChange,
                  }
                : undefined
            }
          />
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}
