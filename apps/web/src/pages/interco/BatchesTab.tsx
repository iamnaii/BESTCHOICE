import { Layers } from 'lucide-react';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PaginationBar } from '@/components/ui/PaginationBar';
import { formatThaiDateShort } from '@/lib/date';
import {
  BATCH_STATUS_BADGE_VARIANT,
  BATCH_STATUS_LABEL,
  fmtMoney,
  type BatchListResponse,
  type InterCoBatchStatus,
} from './types';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — แท็บ "รอบจ่าย" (spec §8 แท็บ 2).
 * รายการ batch ทุกสถานะ + filter chips — คลิกแถวเปิด `BatchDetailSheet`.
 */

const STATUS_CHIPS: Array<{ value: InterCoBatchStatus | undefined; label: string }> = [
  { value: undefined, label: 'ทั้งหมด' },
  { value: 'DRAFT', label: BATCH_STATUS_LABEL.DRAFT },
  { value: 'PENDING_APPROVAL', label: BATCH_STATUS_LABEL.PENDING_APPROVAL },
  { value: 'POSTED', label: BATCH_STATUS_LABEL.POSTED },
  { value: 'REVERSED', label: BATCH_STATUS_LABEL.REVERSED },
  { value: 'CANCELLED', label: BATCH_STATUS_LABEL.CANCELLED },
];

interface BatchesTabProps {
  data: BatchListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  statusFilter: InterCoBatchStatus | undefined;
  onStatusFilterChange: (status: InterCoBatchStatus | undefined) => void;
  page: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  onRowClick: (batchId: string) => void;
}

export function BatchesTab({
  data,
  isLoading,
  isError,
  error,
  onRetry,
  statusFilter,
  onStatusFilterChange,
  page,
  limit,
  onPageChange,
  onLimitChange,
  onRowClick,
}: BatchesTabProps) {
  const batches = data?.data ?? [];

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap gap-2">
        {STATUS_CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => onStatusFilterChange(chip.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium leading-snug border transition-colors ${
              statusFilter === chip.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted text-muted-foreground border-border hover:bg-accent'
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={onRetry}
        errorTitle="ไม่สามารถโหลดรายการรอบจ่ายได้"
      >
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold flex items-center gap-2 leading-snug">
              <Layers className="h-5 w-5 text-primary" />
              รอบจ่าย ({data?.total ?? 0} รายการ)
            </h2>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm leading-snug">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium text-muted-foreground">เลขที่รอบ</th>
                    <th className="text-center p-3 font-medium text-muted-foreground">วันที่โอน</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">ยอดรวม</th>
                    <th className="text-center p-3 font-medium text-muted-foreground">
                      จำนวนสัญญา
                    </th>
                    <th className="text-center p-3 font-medium text-muted-foreground">สถานะ</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">ผู้สร้าง</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">ผู้อนุมัติ</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground leading-snug">
                        ไม่มีรอบจ่าย
                      </td>
                    </tr>
                  ) : (
                    batches.map((b) => (
                      <tr
                        key={b.id}
                        className="border-t border-border hover:bg-accent/30 cursor-pointer"
                        onClick={() => onRowClick(b.id)}
                      >
                        <td className="p-3 font-medium">{b.batchNumber}</td>
                        <td className="p-3 text-center text-xs text-muted-foreground">
                          {formatThaiDateShort(b.transferDate)}
                        </td>
                        <td className="p-3 text-right tabular-nums font-semibold">
                          {fmtMoney(b.totalAmount)}
                        </td>
                        <td className="p-3 text-center">{b._count.items}</td>
                        <td className="p-3 text-center">
                          <Badge variant={BATCH_STATUS_BADGE_VARIANT[b.status]} appearance="light" size="sm">
                            {BATCH_STATUS_LABEL[b.status]}
                          </Badge>
                        </td>
                        <td className="p-3 text-xs">{b.maker.name}</td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {b.approver?.name ?? '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {data && data.total > 0 && (
              <div className="px-3">
                <PaginationBar
                  total={data.total}
                  page={page}
                  size={limit}
                  onPageChange={onPageChange}
                  onSizeChange={onLimitChange}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </QueryBoundary>
    </div>
  );
}
