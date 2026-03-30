/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo } from 'react';
import { maskNationalId } from '@/utils/mask.util';
import DataTable from '@/components/ui/DataTable';
import type { Customer, CustomersResponse } from './types';

interface CustomerTableProps {
  customers: Customer[];
  result: CustomersResponse | undefined;
  isLoading: boolean;
  navigateToCustomer: (id: string) => void;
  canViewSalary: boolean;
  onPageChange: (page: number) => void;
  onRowDoubleClick: (c: Customer) => void;
}

export default function CustomerTable({
  customers,
  result,
  isLoading,
  navigateToCustomer,
  canViewSalary,
  onPageChange,
  onRowDoubleClick,
}: CustomerTableProps) {
  const columns = useMemo(() => [
    {
      key: 'index',
      label: '#',
      render: (_c: Customer, _col: unknown, idx?: number) => (
        <span className="text-xs text-muted-foreground">{((result?.page || 1) - 1) * (result?.limit || 50) + (idx ?? 0) + 1}</span>
      ),
    },
    {
      key: 'name',
      label: 'ชื่อ',
      render: (c: Customer) => (
        <button onClick={() => navigateToCustomer(c.id)} className="text-left hover:underline">
          <div className="text-primary font-medium">{c.name}</div>
          {c.nickname && <div className="text-xs text-muted-foreground">({c.nickname})</div>}
        </button>
      ),
    },
    { key: 'phone', label: 'เบอร์โทร' },
    {
      key: 'nationalId',
      label: 'เลขบัตร ปชช.',
      render: (c: Customer) => <span className="font-mono text-xs">{maskNationalId(c.nationalId)}</span>,
    },
    {
      key: 'occupation',
      label: 'อาชีพ',
      render: (c: Customer) => <span className="text-sm">{c.occupation || '-'}</span>,
    },
    ...(canViewSalary ? [{
      key: 'salary',
      label: 'เงินเดือน',
      render: (c: Customer) => (
        <span className="text-sm">{c.salary ? Number(c.salary).toLocaleString('th-TH') : '-'}</span>
      ),
    }] : []),
    {
      key: 'contracts',
      label: 'สัญญา',
      render: (c: Customer) => (
        <div className="text-xs">
          <span className="text-sm">{c._count.contracts} สัญญา</span>
          {c.activeContracts > 0 && <div className="text-green-600">{c.activeContracts} ใช้งาน</div>}
          {c.overdueContracts > 0 && <div className="text-red-600">{c.overdueContracts} ค้างชำระ</div>}
        </div>
      ),
    },
    {
      key: 'credit',
      label: 'เครดิต',
      render: (c: Customer) => {
        if (!c.latestCreditStatus) return <span className="text-xs text-muted-foreground">-</span>;
        const statusMap: Record<string, { label: string; cls: string }> = {
          APPROVED: { label: 'ผ่าน', cls: 'bg-green-100 text-green-700' },
          REJECTED: { label: 'ไม่ผ่าน', cls: 'bg-red-100 text-red-700' },
          PENDING: { label: 'รอตรวจ', cls: 'bg-yellow-100 text-yellow-700' },
          MANUAL_REVIEW: { label: 'รอรีวิว', cls: 'bg-orange-100 text-orange-700' },
        };
        const s = statusMap[c.latestCreditStatus] || { label: c.latestCreditStatus, cls: 'bg-muted text-foreground' };
        return (
          <div className="text-xs">
            <span className={`px-1.5 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>
            {c.latestCreditScore != null && <div className="text-muted-foreground mt-0.5">{c.latestCreditScore}/100</div>}
          </div>
        );
      },
    },
    {
      key: 'createdAt',
      label: 'วันที่เพิ่ม',
      render: (c: Customer) => <span className="text-xs">{new Date(c.createdAt).toLocaleDateString('th-TH')}</span>,
    },
  ], [navigateToCustomer, result?.page]);

  return (
    <DataTable
      columns={columns}
      data={customers}
      isLoading={isLoading}
      emptyMessage="ไม่พบลูกค้า"
      onRowDoubleClick={onRowDoubleClick}
      pagination={result ? {
        page: result.page,
        totalPages: result.totalPages,
        total: result.total,
        onPageChange,
      } : undefined}
    />
  );
}
