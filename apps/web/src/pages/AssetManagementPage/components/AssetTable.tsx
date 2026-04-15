import { useMemo } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { Building2 } from 'lucide-react';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, assetStatusMap } from '@/lib/status-badges';
import { Asset, categoryLabels, statusFilterOptions, categoryOptions, inputClass, fmt } from '../types';

interface AssetTableProps {
  assets: Asset[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onRetry: () => void;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  categoryFilter: string;
  onCategoryFilterChange: (value: string) => void;
  isOwner: boolean;
  isOwnerOrManager: boolean;
  onView: (asset: Asset) => void;
  onEdit: (asset: Asset) => void;
  onDispose: (asset: Asset) => void;
}

export default function AssetTable({
  assets,
  isLoading,
  isError,
  error,
  onRetry,
  page,
  totalPages,
  total,
  onPageChange,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  categoryFilter,
  onCategoryFilterChange,
  isOwner,
  isOwnerOrManager,
  onView,
  onEdit,
  onDispose,
}: AssetTableProps) {
  const columns = useMemo(
    () => [
      {
        key: 'assetCode',
        label: 'รหัส',
        sortable: true,
        render: (item: Asset) => <span className="font-mono text-xs">{item.assetCode}</span>,
      },
      {
        key: 'name',
        label: 'ชื่อสินทรัพย์',
        sortable: true,
        render: (item: Asset) => (
          <div>
            <div className="font-medium">{item.name}</div>
            {item.description && (
              <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                {item.description}
              </div>
            )}
          </div>
        ),
      },
      {
        key: 'category',
        label: 'หมวดหมู่',
        render: (item: Asset) => (
          <span className="text-sm">{categoryLabels[item.category] ?? item.category}</span>
        ),
      },
      {
        key: 'costValue',
        label: 'ราคาทุน',
        sortable: true,
        render: (item: Asset) => (
          <span className="font-mono text-sm tabular-nums">{fmt(item.costValue)}</span>
        ),
      },
      {
        key: 'accumulatedDepreciation',
        label: 'ค่าเสื่อมสะสม',
        sortable: true,
        render: (item: Asset) => (
          <span className="font-mono text-sm tabular-nums text-warning">
            {fmt(item.accumulatedDepreciation)}
          </span>
        ),
      },
      {
        key: 'netBookValue',
        label: 'มูลค่าสุทธิ',
        sortable: true,
        render: (item: Asset) => {
          const net = Number(item.costValue) - Number(item.accumulatedDepreciation);
          return (
            <span className="font-mono text-sm tabular-nums font-medium">{fmt(net)}</span>
          );
        },
      },
      {
        key: 'status',
        label: 'สถานะ',
        render: (item: Asset) => {
          const cfg = getStatusBadgeProps(item.status, assetStatusMap);
          return (
            <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
              {cfg.label}
            </Badge>
          );
        },
      },
      {
        key: 'actions',
        label: '',
        render: (item: Asset) => (
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onView(item);
              }}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
              title="ดูรายละเอียด"
            >
              <Eye className="size-4" />
            </button>
            {isOwnerOrManager && item.status !== 'DISPOSED' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(item);
                }}
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
                title="แก้ไข"
              >
                <Pencil className="size-4" />
              </button>
            )}
            {isOwner && item.status === 'ACTIVE' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDispose(item);
                }}
                className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                title="จำหน่าย"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        ),
      },
    ],
    [isOwner, isOwnerOrManager, onView, onEdit, onDispose],
  );

  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="ค้นหาชื่อ/รหัสสินทรัพย์..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className={`${inputClass} max-w-xs`}
        />
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          className={`${inputClass} max-w-[180px]`}
        >
          <option value="">สถานะทั้งหมด</option>
          {statusFilterOptions.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => onCategoryFilterChange(e.target.value)}
          className={`${inputClass} max-w-[180px]`}
        >
          <option value="">หมวดหมู่ทั้งหมด</option>
          {categoryOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Data Table */}
      <QueryBoundary
        isLoading={isLoading && !assets.length}
        isError={isError}
        error={error}
        onRetry={onRetry}
        errorTitle="ไม่สามารถโหลดข้อมูลสินทรัพย์ได้"
      >
        <DataTable
          columns={columns}
          data={assets}
          isLoading={isLoading}
          emptyMessage="ไม่พบสินทรัพย์"
          emptyIcon={Building2}
          emptyDescription="ยังไม่มีข้อมูลสินทรัพย์ถาวร"
          pagination={{
            page,
            totalPages,
            total,
            onPageChange,
          }}
        />
      </QueryBoundary>
    </>
  );
}
