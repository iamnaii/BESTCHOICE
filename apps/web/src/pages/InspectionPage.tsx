import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import DataTable, { type Column } from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { Search } from 'lucide-react';
import { formatDateShort } from '@/utils/formatters';

interface InspectionItem {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial: string | null;
  status: string;
  category: string;
  costPrice: string;
  createdAt: string;
  branch: { id: string; name: string };
}

const statusBadge: Record<string, { label: string; class: string }> = {
  RECEIVED: { label: 'รอตรวจ', class: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  INSPECTING: { label: 'กำลังตรวจ', class: 'bg-warning/10 text-warning dark:bg-warning/15' },
  QC_PASSED: { label: 'ผ่าน QC', class: 'bg-success/10 text-success dark:bg-success/15' },
  QC_FAILED: { label: 'ไม่ผ่าน QC', class: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
  IN_STOCK: { label: 'เข้าสต็อกแล้ว', class: 'bg-primary/10 text-primary' },
};

export default function InspectionPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const limit = 50;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['inspections', page, debouncedSearch, statusFilter, user?.branchId],
    queryFn: async () => {
      const res = await api.get('/products', {
        params: {
          page,
          limit,
          search: debouncedSearch || undefined,
          status: statusFilter || undefined,
          branchId: user?.branchId,
        },
      });
      return res.data;
    },
  });

  const items: InspectionItem[] = data?.data ?? [];
  const total: number = data?.total ?? 0;

  const columns: Column<InspectionItem>[] = [
    {
      key: 'product',
      label: 'สินค้า',
      render: (row) => (
        <div>
          <p className="text-sm font-medium">{row.brand} {row.model}</p>
          <p className="text-xs text-muted-foreground">{row.imeiSerial ?? row.name}</p>
        </div>
      ),
    },
    {
      key: 'category',
      label: 'หมวดหมู่',
      render: (row) => <span className="text-sm">{row.category}</span>,
    },
    {
      key: 'branch',
      label: 'สาขา',
      render: (row) => <span className="text-sm">{row.branch.name}</span>,
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (row) => {
        const badge = statusBadge[row.status] ?? { label: row.status, class: 'bg-gray-100 text-gray-700' };
        return (
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${badge.class}`}>
            {badge.label}
          </span>
        );
      },
    },
    {
      key: 'costPrice',
      label: 'ราคาทุน',
      render: (row) => (
        <span className="text-sm font-mono">
          {Number(row.costPrice).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: 'createdAt',
      label: 'วันที่รับ',
      render: (row) => (
        <span className="text-sm text-muted-foreground">
          {formatDateShort(row.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="ตรวจสอบสินค้า"
        subtitle="ตรวจสอบและอัปเดตสถานะสินค้าที่รับเข้า"
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="ค้นหาสินค้า, IMEI, ยี่ห้อ..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-4 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <option value="">ทุกสถานะ</option>
          <option value="RECEIVED">รอตรวจ</option>
          <option value="INSPECTING">กำลังตรวจ</option>
          <option value="QC_PASSED">ผ่าน QC</option>
          <option value="QC_FAILED">ไม่ผ่าน QC</option>
          <option value="IN_STOCK">เข้าสต็อกแล้ว</option>
        </select>
      </div>

      {/* Table */}
      <QueryBoundary
        isLoading={isLoading && !data}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดรายการตรวจสอบได้"
      >
        <DataTable
          columns={columns}
          data={items}
          isLoading={isLoading}
          pagination={{
            page,
            totalPages: Math.ceil(total / limit),
            total,
            onPageChange: setPage,
          }}
          onRowClick={(row) => navigate(`/inspections/${row.id}`)}
          emptyMessage="ไม่พบรายการตรวจสอบ"
        />
      </QueryBoundary>
    </div>
  );
}
