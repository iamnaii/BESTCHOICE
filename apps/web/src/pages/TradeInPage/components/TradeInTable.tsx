import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import DataTable, { type Column } from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getStatusBadgeProps, tradeInStatusMap } from '@/lib/status-badges';
import { formatThaiDate, formatThaiTime } from '@/lib/date';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  FileText,
  MoreVertical,
  Loader2,
  Gavel,
  Eye,
  Copy,
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
  onDetail: (item: TradeIn) => void;
  isRejectPending: boolean;
  voucherLoadingId: string | null;
  /** Search + filter controls, rendered inside the table's toolbar. */
  filters?: ReactNode;
}

/**
 * Secondary line under a primary cell value.
 * Keeps a reserved height so rows stay the same height whether or not the
 * sub-value exists — otherwise the table looks ragged as you scroll.
 */
function SubLine({ children, title }: { children?: ReactNode; title?: string }) {
  return (
    <div
      className="flex min-h-4 min-w-0 items-center gap-1.5 text-xs leading-snug text-muted-foreground"
      title={title}
    >
      {children}
    </div>
  );
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
  onDetail,
  isRejectPending,
  voucherLoadingId,
  filters,
}: TradeInTableProps) {
  const columns: Column<TradeIn>[] = [
    {
      key: 'createdAt',
      label: 'วันที่/เวลา',
      sortable: true,
      hideable: true,
      width: '116px',
      render: (item) => {
        const at = item.idCardVerifiedAt ?? item.createdAt;
        return (
          <div className="min-w-0">
            <div className="truncate leading-snug tabular-nums text-foreground">
              {formatThaiDate(at)}
            </div>
            <SubLine>
              <span className="tabular-nums">{formatThaiTime(at)} น.</span>
            </SubLine>
          </div>
        );
      },
    },
    {
      key: 'voucherNumber',
      label: 'เลขใบสำคัญ',
      sortable: true,
      hideable: true,
      width: '152px',
      render: (item) =>
        item.voucherNumber ? (
          <div className="truncate font-mono text-foreground" title={item.voucherNumber}>
            {item.voucherNumber}
          </div>
        ) : (
          // A leading column full of bare dashes reads as broken data, so say why it's blank
          <span className="truncate text-muted-foreground">ยังไม่ออกใบ</span>
        ),
    },
    {
      key: 'device',
      label: 'อุปกรณ์',
      render: (item) => {
        const device = [item.deviceBrand, item.deviceModel].filter(Boolean).join(' ');
        return (
          <div className="min-w-0">
            {/* Model owns line 1 outright — storage used to get clipped off its tail */}
            <div className="truncate leading-snug text-foreground" title={device}>
              {device}
            </div>
            <SubLine title={item.imei ?? undefined}>
              {item.deviceStorage && <span className="shrink-0">{item.deviceStorage}</span>}
              {item.deviceStorage && item.imei && <span className="shrink-0">·</span>}
              {item.imei && <span className="truncate font-mono">{item.imei}</span>}
            </SubLine>
          </div>
        );
      },
    },
    {
      key: 'customer',
      label: 'ผู้ขาย',
      sortable: true,
      render: (item) => {
        const name = item.customer?.name || item.sellerName || '-';
        return (
          <div className="min-w-0">
            <div className="truncate font-medium leading-snug text-foreground" title={name}>
              {name}
            </div>
            <SubLine title={item.sellerPhone ?? undefined}>
              {!item.customer && (
                <Badge variant="secondary" appearance="light" size="xs" className="shrink-0">
                  walk-in
                </Badge>
              )}
              {item.sellerPhone && <span className="truncate">{item.sellerPhone}</span>}
            </SubLine>
          </div>
        );
      },
    },
    {
      key: 'estimatedValue',
      label: 'ราคา',
      sortable: true,
      width: '112px',
      align: 'right',
      render: (item) => {
        const value = item.agreedPrice ?? item.offeredPrice ?? item.estimatedValue;
        const methodLabel =
          item.paymentMethod === 'TRADE_IN_CREDIT' ? 'เครดิตเทิร์น' : item.paymentMethod === 'CASH'
            ? 'เงินสด'
            : item.paymentMethod === 'TRANSFER'
              ? 'โอน'
              : null;
        return (
          <div className="min-w-0">
            <div className="truncate font-semibold leading-snug tabular-nums text-foreground">
              {value == null ? (
                <span className="font-normal text-muted-foreground">-</span>
              ) : (
                `฿${Number(value).toLocaleString()}`
              )}
            </div>
            {/* flow + payment method collapsed onto one line — they used to eat two */}
            <SubLine>
              <span className="ml-auto truncate">
                {item.flow === 'EXCHANGE' ? (
                  <span className="font-medium text-warning">เทิร์น</span>
                ) : (
                  'รับซื้อ'
                )}
                {methodLabel && ` · ${methodLabel}`}
              </span>
            </SubLine>
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'สถานะ',
      width: '104px',
      render: (item) => {
        const cfg = getStatusBadgeProps(item.status, tradeInStatusMap);
        return (
          <Badge
            variant={cfg.variant}
            appearance={cfg.appearance}
            size="sm"
            className="whitespace-nowrap"
          >
            {cfg.label}
          </Badge>
        );
      },
    },
    {
      key: 'buyer',
      label: 'ผู้รับซื้อ',
      hideable: true,
      width: '148px',
      render: (item) => {
        const buyer = item.idCardVerifiedBy ?? item.appraisedBy;
        if (!buyer) return <span className="truncate text-muted-foreground">รอรับซื้อ</span>;
        return (
          <div className="truncate text-foreground" title={buyer.name}>
            {buyer.name}
          </div>
        );
      },
    },
    {
      key: 'branch',
      label: 'สาขา',
      hideable: true,
      width: '100px',
      render: (item) =>
        item.branch ? (
          <div className="truncate text-foreground" title={item.branch.name}>
            {item.branch.name}
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'actions',
      label: '',
      sortable: false,
      hideable: false,
      width: '168px',
      stickyRight: true,
      render: (item) => {
        const isVoucherLoading = voucherLoadingId === item.id;
        const showAppraise = item.status === 'PENDING_APPRAISAL' && canManage;
        const showAcceptReject = item.status === 'APPRAISED' && canManage;
        const showVoucher = item.status === 'ACCEPTED' || item.status === 'COMPLETED';

        return (
          <div className="flex items-center justify-end gap-1">
            {/* One primary CTA per row, driven by status — everything else lives in the menu */}
            {showAppraise && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onAppraise(item);
                }}
              >
                <Gavel className="size-3.5" />
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
                <CheckCircle className="size-3.5" />
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
                disabled={isVoucherLoading}
              >
                {isVoucherLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <FileText className="size-3.5" />
                )}
                {item.voucherNumber
                  ? isVoucherLoading
                    ? 'กำลังเปิด...'
                    : 'พิมพ์ใบสำคัญ'
                  : isVoucherLoading
                    ? 'กำลังสร้าง...'
                    : 'ออกใบสำคัญ'}
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="เมนูการทำงาน"
                >
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                {/* Keyboard path to the detail dialog — row click alone isn't reachable by keyboard */}
                <DropdownMenuItem onClick={() => onDetail(item)}>
                  <Eye className="size-4" />
                  ดูรายละเอียด
                </DropdownMenuItem>

                {showVoucher && item.voucherNumber && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={async () => {
                        await navigator.clipboard.writeText(item.voucherNumber!);
                      }}
                    >
                      <Copy className="size-4" />
                      คัดลอกเลขใบสำคัญ
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onVoucher(item)} disabled={isVoucherLoading}>
                      <RefreshCw className="size-4" />
                      พิมพ์ซ้ำ (สำเนา)
                    </DropdownMenuItem>
                  </>
                )}

                {showAcceptReject && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => onReject(item.id)}
                      disabled={isRejectPending}
                    >
                      <XCircle className="size-4" />
                      ปฏิเสธการรับซื้อ
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  return (
    // The error panel is bare markup, so it borrows the table's card surface;
    // loading is handed to DataTable, whose skeleton already matches the columns.
    <div className={isError ? 'rounded-xl border border-border/60 bg-card shadow-card' : undefined}>
      <QueryBoundary
        isLoading={false}
        isError={isError}
        error={error}
        onRetry={onRefetch}
        errorTitle="ไม่สามารถโหลดรายการรับซื้อได้"
      >
        <DataTable
          columns={columns}
          data={data || []}
          isLoading={isLoading}
          density="compact"
          minWidth="1340px"
          emptyMessage="ไม่พบรายการรับซื้อ"
          emptyIcon={RefreshCw}
          toolbar={filters}
          columnToggle
          onRowClick={onDetail}
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
    </div>
  );
}
