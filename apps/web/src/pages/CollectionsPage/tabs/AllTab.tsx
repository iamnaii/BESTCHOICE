import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent } from '@/components/ui/card';
import { formatDateShort } from '@/utils/formatters';
import { exportToExcel } from '@/utils/excel.util';
import { toast } from 'sonner';
import { Download } from 'lucide-react';

/**
 * AllTab — audit/admin "table of all overdue payments" view embedded inside
 * CollectionsPage. Z4: The previous implementation embedded the legacy
 * OverduePage wholesale (including its own PageHeader, modals, kanban view,
 * cron buttons). Now inlined as a focused, header-less subset:
 *
 *   - Table of payments with PENDING/OVERDUE status (mirrors GET /payments/pending)
 *   - Search + branch filter (OWNER only)
 *   - Excel export
 *
 * Action UX (assign, settlement, log-contact, kanban) lives in the workflow
 * tabs and the contract detail page now — no duplicate surfaces.
 */

interface OverduePayment {
  id: string;
  installmentNo: number;
  dueDate: string;
  amountDue: string;
  amountPaid: string;
  lateFee: string;
  status: string;
  contract: {
    id: string;
    contractNumber: string;
    customer: { id: string; name: string; phone: string };
    branch: { id: string; name: string };
  };
}

export default function AllTab() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';

  const [filter, setFilter] = useState<'OVERDUE' | 'all'>('OVERDUE');
  const [searchTerm, setSearchTerm] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const debouncedSearch = useDebounce(searchTerm);

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
    enabled: isOwner,
  });

  const {
    data: overduePayments = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<OverduePayment[]>({
    queryKey: ['overdue-payments-all', filter, debouncedSearch, branchFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('status', filter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (branchFilter) params.set('branchId', branchFilter);
      const { data } = await api.get(`/payments/pending?${params}`);
      return data.data;
    },
  });

  const { totalLateFees, totalOutstanding, uniqueContracts } = useMemo(
    () => ({
      totalLateFees: overduePayments.reduce((sum, p) => {
        const v = parseFloat(p.lateFee);
        return sum + (isNaN(v) ? 0 : v);
      }, 0),
      totalOutstanding: overduePayments.reduce((sum, p) => {
        const due = parseFloat(p.amountDue);
        const paid = parseFloat(p.amountPaid);
        return sum + ((isNaN(due) ? 0 : due) - (isNaN(paid) ? 0 : paid));
      }, 0),
      uniqueContracts: new Set(overduePayments.map((p) => p.contract.id)).size,
    }),
    [overduePayments],
  );

  const navigateToContract = useCallback(
    (id: string) => navigate(`/contracts/${id}`),
    [navigate],
  );

  const columns = useMemo(
    () => [
      {
        key: 'contract',
        label: 'สัญญา',
        render: (p: OverduePayment) => (
          <button onClick={() => navigateToContract(p.contract.id)} className="text-left">
            <div className="font-mono text-sm text-primary hover:underline whitespace-nowrap">
              {p.contract.contractNumber}
            </div>
            <div className="text-xs text-muted-foreground whitespace-nowrap">
              {p.contract.customer.name}
            </div>
          </button>
        ),
      },
      {
        key: 'phone',
        label: 'เบอร์โทร',
        render: (p: OverduePayment) => (
          <span className="text-sm whitespace-nowrap">{p.contract.customer.phone}</span>
        ),
      },
      {
        key: 'installmentNo',
        label: 'งวดที่',
        render: (p: OverduePayment) => <span className="font-medium">{p.installmentNo}</span>,
      },
      {
        key: 'dueDate',
        label: 'วันครบกำหนด',
        render: (p: OverduePayment) => {
          const due = new Date(p.dueDate);
          const now = new Date();
          const daysLate = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
          return (
            <div>
              <div className="text-sm">{formatDateShort(due)}</div>
              {daysLate > 0 && (
                <div className="text-xs text-destructive font-medium">เกินกำหนด {daysLate} วัน</div>
              )}
            </div>
          );
        },
      },
      {
        key: 'outstanding',
        label: 'ยอดค้าง',
        render: (p: OverduePayment) => {
          const outstanding = parseFloat(p.amountDue) - parseFloat(p.amountPaid);
          return <span className="text-sm font-medium">{outstanding.toLocaleString()} ฿</span>;
        },
      },
      {
        key: 'lateFee',
        label: 'ค่าปรับ',
        render: (p: OverduePayment) => {
          const fee = parseFloat(p.lateFee);
          return fee > 0 ? (
            <span className="text-sm font-medium text-destructive">{fee.toLocaleString()} ฿</span>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          );
        },
      },
      {
        key: 'total',
        label: 'ยอดรวม',
        render: (p: OverduePayment) => {
          const total =
            (parseFloat(p.amountDue) || 0) +
            (parseFloat(p.lateFee) || 0) -
            (parseFloat(p.amountPaid) || 0);
          return <span className="text-sm font-bold text-destructive">{total.toLocaleString()} ฿</span>;
        },
      },
      {
        key: 'branch',
        label: 'สาขา',
        render: (p: OverduePayment) => <span className="text-xs">{p.contract.branch.name}</span>,
      },
    ],
    [navigateToContract],
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
          <CardContent className="p-4">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              สัญญาค้างชำระ
            </div>
            <div className="text-2xl font-bold tabular-nums text-destructive">{uniqueContracts}</div>
          </CardContent>
        </Card>
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
          <CardContent className="p-4">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              ยอดค้างรวม
            </div>
            <div className="text-2xl font-bold tabular-nums">{totalOutstanding.toLocaleString()} ฿</div>
          </CardContent>
        </Card>
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
          <CardContent className="p-4">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              ค่าปรับรวม
            </div>
            <div className="text-2xl font-bold tabular-nums text-destructive">
              {totalLateFees.toLocaleString()} ฿
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3 flex-wrap bg-card rounded-xl border border-border/50 shadow-sm p-4">
        <input
          type="text"
          placeholder="ค้นหาเลขสัญญา, ชื่อลูกค้า..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm min-w-[250px] focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background focus:border-transparent"
        />
        {overduePayments.length > 0 && (
          <button
            onClick={async () => {
              try {
                await exportToExcel({
                  columns: [
                    { header: 'เลขสัญญา', key: 'contractNumber', width: 15 },
                    { header: 'ลูกค้า', key: 'customer', width: 20 },
                    { header: 'เบอร์โทร', key: 'phone', width: 15 },
                    { header: 'งวดที่', key: 'installmentNo', width: 10 },
                    { header: 'ยอดค้าง', key: 'outstanding', width: 15 },
                    { header: 'ค่าปรับ', key: 'lateFee', width: 15 },
                    { header: 'วันครบกำหนด', key: 'dueDate', width: 15 },
                    { header: 'จำนวนวันเลย', key: 'daysLate', width: 15 },
                  ],
                  data: overduePayments.map((p) => {
                    const due = new Date(p.dueDate);
                    const now = new Date();
                    const daysLate = Math.max(
                      0,
                      Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)),
                    );
                    return {
                      contractNumber: p.contract.contractNumber,
                      customer: p.contract.customer.name,
                      phone: p.contract.customer.phone,
                      installmentNo: p.installmentNo,
                      outstanding: (
                        parseFloat(p.amountDue) - parseFloat(p.amountPaid)
                      ).toLocaleString(),
                      lateFee: parseFloat(p.lateFee).toLocaleString(),
                      dueDate: formatDateShort(due),
                      daysLate,
                    };
                  }),
                  sheetName: 'ค้างชำระ',
                  filename: `overdue_${new Date().toISOString().slice(0, 10)}.xlsx`,
                });
                toast.success('ส่งออก Excel สำเร็จ');
              } catch {
                toast.error('ไม่สามารถส่งออก Excel ได้');
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
          >
            <Download className="size-4" />
            ส่งออก Excel
          </button>
        )}
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'OVERDUE' | 'all')}
          className="px-3 py-2 border border-input rounded-lg text-sm"
        >
          <option value="OVERDUE">เฉพาะเกินกำหนด</option>
          <option value="all">ทั้งหมด</option>
        </select>
        {isOwner && (
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm"
          >
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดรายการค้างชำระได้"
      >
        <DataTable columns={columns} data={overduePayments} emptyMessage="ไม่มีรายการค้างชำระ" />
      </QueryBoundary>
    </div>
  );
}
