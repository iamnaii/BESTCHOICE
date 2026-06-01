import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useDebounce } from '@/hooks/useDebounce';
import { Plus, ChevronDown, Search } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable, { type Column } from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { contactKeys, contactsApi, type Contact, type ContactRole } from '@/lib/api/contacts';

const ROLE_LABELS: Record<ContactRole, string> = {
  CUSTOMER: 'ลูกค้า',
  SUPPLIER: 'ผู้ขาย',
  TRADE_IN_SELLER: 'คนขายมือสอง',
  FINANCE_COMPANY: 'ไฟแนนซ์',
};

const ROLE_BADGE_VARIANT: Record<ContactRole, 'primary' | 'info' | 'warning' | 'secondary'> = {
  CUSTOMER: 'primary',
  SUPPLIER: 'info',
  TRADE_IN_SELLER: 'warning',
  FINANCE_COMPANY: 'secondary',
};

type GroupFilter = 'ALL' | ContactRole;

const GROUP_FILTERS: { value: GroupFilter; label: string }[] = [
  { value: 'ALL', label: 'ทั้งหมด' },
  { value: 'CUSTOMER', label: 'ลูกค้า' },
  { value: 'SUPPLIER', label: 'ผู้ขาย' },
  { value: 'TRADE_IN_SELLER', label: 'คนขายมือสอง' },
  { value: 'FINANCE_COMPANY', label: 'ไฟแนนซ์' },
];

export default function ContactsPage() {
  useDocumentTitle('สมุดผู้ติดต่อ');
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [role, setRole] = useState<GroupFilter>('ALL');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, role]);

  const { data: result, isLoading, isError, error, refetch } = useQuery({
    queryKey: contactKeys.list({ search: debouncedSearch, role, page }),
    queryFn: () => contactsApi.list({ search: debouncedSearch, role, page, limit: 50 }),
  });

  const contacts = result?.data ?? [];
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.limit)) : 1;

  const columns = useMemo<Column<Contact>[]>(
    () => [
      {
        key: 'contactCode',
        label: 'เลขที่',
        render: (c) => (
          <span className="font-mono text-xs text-muted-foreground">{c.contactCode}</span>
        ),
      },
      {
        key: 'name',
        label: 'ชื่อ',
        render: (c) => (
          <span className="text-sm font-semibold text-foreground leading-snug">{c.name}</span>
        ),
      },
      {
        key: 'roles',
        label: 'กลุ่ม',
        render: (c) => (
          <div className="flex flex-wrap gap-1">
            {c.roles.map((r) => (
              <Badge key={r} variant={ROLE_BADGE_VARIANT[r]} appearance="light" size="sm">
                {ROLE_LABELS[r]}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        key: 'phone',
        label: 'เบอร์โทร',
        hideable: true,
        render: (c) => (
          <span className="text-sm text-foreground tabular-nums">{c.phone || '—'}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="สมุดผู้ติดต่อ"
        subtitle={`ทั้งหมด ${result?.total ?? 0} ราย`}
        action={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                <Plus className="size-4" />
                เพิ่มผู้ติดต่อ
                <ChevronDown className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => navigate('/customers')}>
                เพิ่มลูกค้า
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/suppliers')}>
                เพิ่มผู้ขาย
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/trade-in')}>
                รับซื้อมือสอง
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="bg-card rounded-xl border border-border/50 p-4 mb-5 shadow-sm">
        {/* Group filter tabs */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {GROUP_FILTERS.map((g) => (
            <button
              key={g.value}
              onClick={() => setRole(g.value)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors leading-snug ${
                role === g.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-input text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="ค้นหาชื่อ, เลขที่, เบอร์โทร..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-input rounded-lg text-sm outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-ring transition-colors bg-background"
          />
        </div>
      </div>

      <QueryBoundary
        isLoading={isLoading && !result}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดสมุดผู้ติดต่อได้"
      >
        <DataTable
          columns={columns}
          data={contacts}
          isLoading={isLoading}
          emptyMessage="ไม่พบผู้ติดต่อ"
          onRowClick={(c) => navigate(`/contacts/${c.id}`)}
          pagination={
            result
              ? {
                  page: result.page,
                  totalPages,
                  total: result.total,
                  onPageChange: setPage,
                }
              : undefined
          }
        />
      </QueryBoundary>
    </div>
  );
}
