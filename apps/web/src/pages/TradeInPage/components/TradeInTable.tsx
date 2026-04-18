import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import DataTable, { type Column } from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getStatusBadgeProps, tradeInStatusMap } from '@/lib/status-badges';
import { formatThaiDate } from '@/lib/date';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  FileText,
  MoreVertical,
  Loader2,
  Gavel,
} from 'lucide-react';
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
  voucherLoadingId: string | null;
}

function formatRelativeDate(iso: string): string {
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'วันนี้';
  if (diffDays === 1) return 'เมื่อวาน';
  if (diffDays < 7) return `${diffDays} วันก่อน`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} สัปดาห์ก่อน`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} เดือนก่อน`;
  return formatThaiDate(iso);
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
  voucherLoadingId,
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
        <div className="min-w-0">
          <div className="text-sm text-foreground">
            {item.deviceBrand} {item.deviceModel}
            {item.deviceStorage && (
              <span className="text-muted-foreground ml-1">({item.deviceStorage})</span>
            )}
          </div>
          {item.imei && (
            <div className="text-xs text-muted-foreground font-mono">IMEI {item.imei}</div>
          )}
        </div>
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
      key: 'voucherNumber',
      label: 'เลขใบสำคัญ',
      hideable: true,
      render: (item) =>
        item.voucherNumber ? (
          <span className="text-xs font-mono text-foreground">{item.voucherNumber}</span>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        ),
    },
    {
      key: 'createdAt',
      label: 'วันที่',
      sortable: true,
      hideable: true,
      render: (item) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatRelativeDate(item.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      sortable: false,
      hideable: false,
      render: (item) => {
        const isLoading = voucherLoadingId === item.id;
        const showAppraise = item.status === 'PENDING_APPRAISAL' && canManage;
        const showAcceptReject = item.status === 'APPRAISED' && canManage;
        const showVoucher = item.status === 'ACCEPTED' || item.status === 'COMPLETED';

        return (
          <div className="flex items-center justify-end gap-1">
            {/* Primary CTA — inline ตาม status */}
            {showAppraise && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onAppraise(item);
                }}
              >
                <Gavel className="size-3.5 mr-1" />
                ประเมิน
              </Button>
            )}
            {showAcceptReject && (
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
            )}
            {showVoucher && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onVoucher(item);
                }}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="size-3.5 mr-1 animate-spin" />
                ) : (
                  <FileText className="size-3.5 mr-1" />
                )}
                {item.voucherNumber
                  ? isLoading
                    ? 'กำลังเปิด...'
                    : 'พิมพ์ใบสำคัญ'
                  : isLoading
                    ? 'กำลังสร้าง...'
                    : 'ออกใบสำคัญ'}
              </Button>
            )}

            {/* Secondary actions — kebab menu */}
            {showAcceptReject && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    aria-label="เมนูการทำงาน"
                  >
                    <MoreVertical className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => onReject(item.id)}
                    disabled={isRejectPending}
                  >
                    <XCircle className="size-4" />
                    ปฏิเสธการรับซื้อ
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {showVoucher && item.voucherNumber && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    aria-label="เมนูการทำงาน"
                  >
                    <MoreVertical className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem
                    onClick={async () => {
                      await navigator.clipboard.writeText(item.voucherNumber!);
                    }}
                  >
                    <FileText className="size-4" />
                    คัดลอกเลขใบสำคัญ
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onVoucher(item)} disabled={isLoading}>
                    <RefreshCw className="size-4" />
                    พิมพ์ซ้ำ (สำเนา)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );
      },
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
            columnToggle
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
