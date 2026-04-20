import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Copy, MoreVertical, Brain, Pencil, ExternalLink } from 'lucide-react';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { formatDateShort, formatDateTime } from '@/utils/formatters';
import { type CreditCheckItem, type CreditChecksResponse, statusLabels, getRiskBadge } from './types';

interface CreditCheckTableProps {
  creditChecks: CreditCheckItem[];
  creditChecksData: CreditChecksResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onRowClick: (cc: CreditCheckItem) => void;
  onPageChange: (page: number) => void;
  canOverride: boolean;
  isAnalyzePending: boolean;
  onAnalyze: (customerId: string, creditCheckId: string) => void;
  onOverrideOpen: (creditCheckId: string, customerId: string) => void;
}

const formatRelativeDate = (iso: string): string => {
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'วันนี้';
  if (diffDays === 1) return 'เมื่อวาน';
  if (diffDays < 7) return `${diffDays} วันก่อน`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} สัปดาห์ก่อน`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} เดือนก่อน`;
  return formatDateShort(iso);
};

export default function CreditCheckTable({
  creditChecks,
  creditChecksData,
  isLoading,
  isError,
  error,
  onRetry,
  onRowClick,
  onPageChange,
  canOverride,
  isAnalyzePending,
  onAnalyze,
  onOverrideOpen,
}: CreditCheckTableProps) {
  const navigate = useNavigate();
  const { copy } = useCopyToClipboard();

  const copyValue = useCallback(
    (e: React.MouseEvent, value: string, label: string) => {
      e.stopPropagation();
      copy(value);
      toast.success(`คัดลอก${label}แล้ว`);
    },
    [copy],
  );

  const columns = [
    {
      key: 'customer',
      label: 'ลูกค้า',
      render: (cc: CreditCheckItem) => (
        <div>
          <div className="text-sm font-medium text-foreground whitespace-nowrap">{cc.customer.name}</div>
          <div className="group/phone flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
            <span>{cc.customer.phone}</span>
            {cc.customer.phone && (
              <button
                type="button"
                onClick={(e) => copyValue(e, cc.customer.phone, 'เบอร์โทร')}
                className="opacity-0 group-hover/phone:opacity-100 p-0.5 hover:bg-accent rounded transition-opacity"
                aria-label="คัดลอกเบอร์โทร"
                title="คัดลอกเบอร์โทร"
              >
                <Copy className="size-3" />
              </button>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (cc: CreditCheckItem) => {
        const s = statusLabels[cc.status] || { label: cc.status, className: 'bg-muted' };
        return (
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${s.className}`}>
            {s.label}
          </span>
        );
      },
    },
    {
      key: 'aiScore',
      label: 'คะแนน',
      render: (cc: CreditCheckItem) =>
        cc.aiScore !== null ? (
          <div className="flex items-center gap-2">
            <span
              className={`text-sm font-bold ${
                cc.aiScore >= 70
                  ? 'text-success'
                  : cc.aiScore >= 50
                    ? 'text-warning'
                    : 'text-destructive'
              }`}
            >
              {cc.aiScore}
            </span>
            <div className="w-16 bg-muted rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full ${
                  cc.aiScore >= 70
                    ? 'bg-success'
                    : cc.aiScore >= 50
                      ? 'bg-warning'
                      : 'bg-destructive'
                }`}
                style={{ width: `${cc.aiScore}%` }}
              />
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        ),
    },
    {
      key: 'risk',
      label: 'ความเสี่ยง',
      hideable: true,
      render: (cc: CreditCheckItem) => getRiskBadge(cc.aiScore),
    },
    {
      key: 'bankName',
      label: 'ธนาคาร',
      hideable: true,
      render: (cc: CreditCheckItem) => <span className="text-sm">{cc.bankName || '-'}</span>,
    },
    {
      key: 'contract',
      label: 'สัญญา',
      hideable: true,
      render: (cc: CreditCheckItem) =>
        cc.contract ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/contracts/${cc.contract!.id}`);
            }}
            className="text-xs text-primary hover:underline font-mono"
          >
            {cc.contract.contractNumber}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">ยังไม่มีสัญญา</span>
        ),
    },
    {
      key: 'createdAt',
      label: 'วันที่สร้าง',
      hideable: true,
      render: (cc: CreditCheckItem) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatRelativeDate(cc.createdAt)}
        </span>
      ),
    },
    {
      key: 'approver',
      label: 'ผู้อนุมัติ',
      hideable: true,
      render: (cc: CreditCheckItem) =>
        cc.checkedBy ? (
          <div>
            <div className="text-sm font-medium text-foreground">{cc.checkedBy.name}</div>
            {cc.checkedAt && (
              <div className="text-xs text-muted-foreground">{formatDateTime(cc.checkedAt)}</div>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        ),
    },
    {
      key: 'actions',
      label: '',
      sortable: false,
      hideable: false,
      render: (cc: CreditCheckItem) => (
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
            <DropdownMenuItem onClick={() => navigate(`/customers/${cc.customer.id}`)}>
              <ExternalLink className="size-4" />
              ดูข้อมูลลูกค้า
            </DropdownMenuItem>
            {cc.status === 'PENDING' && (
              <DropdownMenuItem
                onClick={() => onAnalyze(cc.customer.id, cc.id)}
                disabled={isAnalyzePending}
              >
                <Brain className="size-4" />
                AI วิเคราะห์
              </DropdownMenuItem>
            )}
            {canOverride && cc.aiScore !== null && (
              <DropdownMenuItem onClick={() => onOverrideOpen(cc.id, cc.customer.id)}>
                <Pencil className="size-4" />
                ปรับแก้
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <QueryBoundary
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={onRetry}
      errorTitle="ไม่สามารถโหลดรายการตรวจเครดิตได้"
    >
      <DataTable
        columns={columns}
        data={creditChecks}
        emptyMessage="ยังไม่มีรายการตรวจเครดิต"
        columnToggle
        onRowClick={(cc: CreditCheckItem) => onRowClick(cc)}
        pagination={
          creditChecksData
            ? {
                page: creditChecksData.page,
                totalPages: creditChecksData.totalPages,
                total: creditChecksData.total,
                onPageChange,
              }
            : undefined
        }
      />
    </QueryBoundary>
  );
}
