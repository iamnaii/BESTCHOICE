import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, Users } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import QueryBoundary from '@/components/QueryBoundary';
import DataTable, { type Column } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { employeeKeys, employeesApi, type Employee } from '@/lib/api/employees';
import ProvisionEmployeeDialog from '@/components/employees/ProvisionEmployeeDialog';
import EditEmployeeDialog from '@/components/employees/EditEmployeeDialog';

const EMPLOYMENT_LABELS: Record<string, string> = {
  MONTHLY: 'รายเดือน',
  DAILY: 'รายวัน',
  CONTRACT: 'สัญญาจ้าง',
};

export default function EmployeesPage() {
  useDocumentTitle('พนักงาน');
  const { user } = useAuth();
  const canManage = ['OWNER', 'ACCOUNTANT'].includes(user?.role ?? '');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);
  const [page, setPage] = useState(1);
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: employeeKeys.list({ search: debounced || undefined, page }),
    queryFn: () => employeesApi.list({ search: debounced || undefined, page }),
  });

  const columns: Column<Employee>[] = [
    { key: 'employeeId', label: 'รหัส', render: (e) => e.user.employeeId || '—' },
    {
      key: 'name',
      label: 'ชื่อ',
      render: (e) => (
        <div className="leading-snug">
          <div className="text-foreground">{e.user.name}</div>
          {e.user.nickname && (
            <div className="text-xs text-muted-foreground">{e.user.nickname}</div>
          )}
        </div>
      ),
    },
    { key: 'position', label: 'ตำแหน่ง', render: (e) => e.position || '—' },
    {
      key: 'employmentType',
      label: 'ประเภทจ้าง',
      render: (e) => EMPLOYMENT_LABELS[e.employmentType] ?? e.employmentType,
    },
    { key: 'nationalId', label: 'เลขบัตร', render: (e) => e.user.nationalId || '—' },
    {
      key: 'status',
      label: 'สถานะ',
      render: (e) =>
        e.resignedDate ? (
          <Badge variant="secondary" appearance="light" size="sm">
            ลาออก
          </Badge>
        ) : (
          <Badge variant="primary" appearance="light" size="sm">
            ทำงาน
          </Badge>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground leading-snug flex items-center gap-2">
          <Users className="size-5" /> พนักงาน
        </h1>
        {canManage && (
          <Button onClick={() => setProvisionOpen(true)}>
            <UserPlus className="size-4" /> เพิ่มพนักงาน
          </Button>
        )}
      </div>

      <Input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        placeholder="ค้นหาด้วยชื่อ / ชื่อเล่น / รหัสพนักงาน"
        className="max-w-sm"
      />

      <QueryBoundary
        isLoading={isLoading && !data}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดรายชื่อพนักงานได้"
      >
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          isLoading={isLoading}
          emptyMessage="ไม่พบพนักงาน"
          onRowClick={canManage ? (e) => setEditId(e.id) : undefined}
          pagination={
            data
              ? {
                  page: data.page,
                  totalPages: Math.max(1, Math.ceil(data.total / data.limit)),
                  total: data.total,
                  onPageChange: setPage,
                }
              : undefined
          }
        />
      </QueryBoundary>

      {canManage && (
        <>
          <ProvisionEmployeeDialog open={provisionOpen} onOpenChange={setProvisionOpen} />
          <EditEmployeeDialog id={editId} onClose={() => setEditId(null)} />
        </>
      )}
    </div>
  );
}
