import { useNavigate } from 'react-router';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { formatDateShort, formatDateTime } from '@/utils/formatters';
import { type CreditCheckItem, type CreditChecksResponse, statusLabels, getRiskBadge } from './types';
import CreditCheckDetail from './CreditCheckDetail';

interface CreditCheckTableProps {
  creditChecks: CreditCheckItem[];
  creditChecksData: CreditChecksResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  expandedRow: string | null;
  onRowClick: (cc: CreditCheckItem) => void;
  onExpandedClose: () => void;
  onPageChange: (page: number) => void;
  canOverride: boolean;
  isAnalyzePending: boolean;
  onAnalyze: (customerId: string, creditCheckId: string) => void;
  onOverrideOpen: (creditCheckId: string, customerId: string) => void;
}

export default function CreditCheckTable({
  creditChecks,
  creditChecksData,
  isLoading,
  isError,
  error,
  onRetry,
  expandedRow,
  onRowClick,
  onExpandedClose,
  onPageChange,
  canOverride,
  isAnalyzePending,
  onAnalyze,
  onOverrideOpen,
}: CreditCheckTableProps) {
  const navigate = useNavigate();

  const columns = [
    {
      key: 'customer',
      label: 'ลูกค้า',
      render: (cc: CreditCheckItem) => (
        <div>
          <button
            onClick={() => navigate(`/customers/${cc.customer.id}`)}
            className="text-sm font-medium text-primary hover:underline"
          >
            {cc.customer.name}
          </button>
          <div className="text-xs text-muted-foreground">{cc.customer.phone}</div>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (cc: CreditCheckItem) => {
        const s = statusLabels[cc.status] || { label: cc.status, className: 'bg-muted' };
        return (
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${s.className}`}>
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
      render: (cc: CreditCheckItem) => getRiskBadge(cc.aiScore),
    },
    {
      key: 'bankName',
      label: 'ธนาคาร',
      render: (cc: CreditCheckItem) => <span className="text-sm">{cc.bankName || '-'}</span>,
    },
    {
      key: 'contract',
      label: 'สัญญา',
      render: (cc: CreditCheckItem) =>
        cc.contract ? (
          <button
            onClick={() => navigate(`/contracts/${cc.contract!.id}`)}
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
      render: (cc: CreditCheckItem) => (
        <span className="text-xs text-muted-foreground">{formatDateShort(cc.createdAt)}</span>
      ),
    },
    {
      key: 'approver',
      label: 'ผู้อนุมัติ',
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
      render: (cc: CreditCheckItem) => (
        <div className="flex gap-2">
          {cc.status === 'PENDING' && (
            <button
              onClick={() => onAnalyze(cc.customer.id, cc.id)}
              disabled={isAnalyzePending}
              className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              AI วิเคราะห์
            </button>
          )}
          {canOverride && cc.aiScore !== null && (
            <button
              onClick={() => onOverrideOpen(cc.id, cc.customer.id)}
              className="px-3 py-1 text-xs bg-primary/10 text-primary rounded-lg hover:bg-primary/20"
            >
              ปรับแก้
            </button>
          )}
        </div>
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
      <>
        <DataTable
          columns={columns}
          data={creditChecks}
          emptyMessage="ยังไม่มีรายการตรวจเครดิต"
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

        {/* Expanded AI detail */}
        {expandedRow && creditChecks.find((cc) => cc.id === expandedRow) && (
          <CreditCheckDetail
            creditCheck={creditChecks.find((c) => c.id === expandedRow)!}
            onClose={onExpandedClose}
          />
        )}
      </>
    </QueryBoundary>
  );
}
