import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Wrench, ShieldCheck } from 'lucide-react';
import api from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { formatDateShort, formatNumber } from '@/utils/formatters';
import { RepairStatusBadge, type RepairStatus } from './insurance/components/RepairStatusBadge';

interface RepairTicket {
  id: string;
  ticketNumber: string;
  status: RepairStatus;
  defectDescription: string;
  actualCost: string | null;
  estimatedCost: string | null;
  createdAt: string;
  customer: { id: string; name: string; phone: string };
  deviceBrand: string | null;
  deviceModel: string | null;
}

interface TicketsResponse {
  data: RepairTicket[];
  total: number;
  page: number;
  limit: number;
}

const STATUS_FILTERS: Array<{ label: string; value: RepairStatus | '' }> = [
  { label: 'ทั้งหมด', value: '' },
  { label: 'รับเข้า', value: 'OPEN' },
  { label: 'กำลังซ่อม', value: 'IN_PROGRESS' },
  { label: 'รอลูกค้ารับ', value: 'READY_FOR_PICKUP' },
  { label: 'คืนแล้ว', value: 'CLOSED' },
  { label: 'เปลี่ยนแล้ว', value: 'REPLACED' },
  { label: 'ยกเลิก', value: 'CANCELLED' },
];

/** Returns Tailwind left-border class for aging tickets based on status + age in days */
function agingBorderClass(ticket: RepairTicket): string {
  const ageMs = Date.now() - new Date(ticket.createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ticket.status === 'OPEN' && ageDays > 3) return 'border-l-4 border-l-orange-500';
  if (ticket.status === 'IN_PROGRESS' && ageDays > 14) return 'border-l-4 border-l-red-500';
  if (ticket.status === 'READY_FOR_PICKUP' && ageDays > 7) return 'border-l-4 border-l-purple-500';
  return '';
}

function deviceLabel(ticket: RepairTicket): string {
  const parts = [ticket.deviceBrand, ticket.deviceModel].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : '—';
}

function TicketsTable({
  tickets,
  onRowClick,
}: {
  tickets: RepairTicket[];
  onRowClick: (id: string) => void;
}) {
  if (tickets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <Wrench className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm">ไม่มีรายการซ่อม</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-2 px-3 font-medium">เลขที่</th>
            <th className="text-left py-2 px-3 font-medium">ลูกค้า</th>
            <th className="text-left py-2 px-3 font-medium">เครื่อง</th>
            <th className="text-left py-2 px-3 font-medium">อาการ</th>
            <th className="text-left py-2 px-3 font-medium">สถานะ</th>
            <th className="text-right py-2 px-3 font-medium">ค่าซ่อม</th>
            <th className="text-left py-2 px-3 font-medium">วันรับ</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr
              key={t.id}
              onClick={() => onRowClick(t.id)}
              className={`border-b border-border last:border-0 cursor-pointer hover:bg-accent transition-colors ${agingBorderClass(t)}`}
            >
              <td className="py-2 px-3 font-mono text-xs">{t.ticketNumber}</td>
              <td className="py-2 px-3">
                <div className="font-medium leading-snug">{t.customer.name}</div>
                <div className="text-xs text-muted-foreground leading-snug">{t.customer.phone}</div>
              </td>
              <td className="py-2 px-3 text-muted-foreground">{deviceLabel(t)}</td>
              <td className="py-2 px-3 max-w-[200px]">
                <p className="truncate text-muted-foreground" title={t.defectDescription}>
                  {t.defectDescription}
                </p>
              </td>
              <td className="py-2 px-3">
                <RepairStatusBadge status={t.status} />
              </td>
              <td className="py-2 px-3 text-right">
                {t.actualCost != null
                  ? formatNumber(t.actualCost)
                  : t.estimatedCost != null
                    ? `~${formatNumber(t.estimatedCost)}`
                    : '—'}
              </td>
              <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                {formatDateShort(t.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InsuranceListContent() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RepairStatus | ''>('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 350);

  const q = useQuery<TicketsResponse>({
    queryKey: ['repair-tickets', debouncedSearch, statusFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);
      const res = await api.get(`/repair-tickets?${params.toString()}`);
      return res.data;
    },
    staleTime: 30_000,
  });

  const tickets = q.data?.data ?? [];
  const total = q.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={q.refetch}>
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="ค้นหา (ชื่อลูกค้า, เลขที่, IMEI...)"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => {
              setStatusFilter(f.value);
              setPage(1);
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
              statusFilter === f.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted text-muted-foreground border-transparent hover:bg-accent'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <Card>
        <TicketsTable tickets={tickets} onRowClick={(id) => navigate(`/insurance/${id}`)} />
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {total} รายการ — หน้า {page}/{totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ก่อนหน้า
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              ถัดไป
            </Button>
          </div>
        </div>
      )}

      {tickets.length === 0 && !search && !statusFilter && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <Wrench className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm font-medium mb-2">ยังไม่มีรายการซ่อม</p>
          <Button size="sm" onClick={() => navigate('/insurance/new')}>
            <Plus className="mr-2 h-4 w-4" />
            รับเครื่องเข้าซ่อม
          </Button>
        </div>
      )}
    </div>
    </QueryBoundary>
  );
}

export default function InsurancePage() {
  const navigate = useNavigate();

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title="รับซ่อม/รับประกัน"
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/insurance/warranty-check')}>
              <ShieldCheck className="mr-2 h-4 w-4" />
              เช็คประกัน
            </Button>
            <Button onClick={() => navigate('/insurance/new')}>
              <Plus className="mr-2 h-4 w-4" />
              รับเครื่องเข้าซ่อม
            </Button>
          </div>
        }
      />

      <InsuranceListContent />
    </div>
  );
}
