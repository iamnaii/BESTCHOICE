import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import { Card, CardContent } from '@/components/ui/card';
import { formatDateShort } from '@/utils/formatters';
import {
  FileText,
  Banknote,
  CheckCircle2,
  Clock,
  TrendingUp,
  AlertTriangle,
  ShieldAlert,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface PortfolioContract {
  id: string;
  contractNumber: string;
  status: string;
  customer: { id: string; name: string; phone: string };
  product: { brand: string | null; model: string | null; imeiSerial: string | null };
  branch: string;
  sellingPrice: number;
  financedAmount: number;
  monthlyPayment: number;
  totalMonths: number;
  paidInstallments: number;
  remainingInstallments: number;
  totalReceivable: number;
  totalPaid: number;
  outstanding: number;
  nextDueDate: string | null;
  createdAt: string;
}

interface AgingBucket {
  count: number;
  amount: number;
}

interface PortfolioResponse {
  data: PortfolioContract[];
  summary: {
    totalContracts: number;
    totalReceivable: number;
    totalCollected: number;
    totalOutstanding: number;
    collectionRate: number;
  };
  aging: {
    current: AgingBucket;
    days1to30: AgingBucket;
    days31to60: AgingBucket;
    days61to90: AgingBucket;
    over90: AgingBucket;
  };
  total: number;
  page: number;
  limit: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return '-';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'ปกติ',
  OVERDUE: 'ค้างชำระ',
  DEFAULT: 'ผิดนัด',
  COMPLETED: 'ชำระครบ',
  EARLY_PAYOFF: 'ปิดก่อนกำหนด',
  EXCHANGED: 'เปลี่ยนเครื่อง',
  CLOSED_BAD_DEBT: 'หนี้สูญ',
  ALL: 'ทั้งหมด',
};

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'bg-success/10 text-success',
  OVERDUE: 'bg-destructive/10 text-destructive',
  DEFAULT: 'bg-destructive/10 text-destructive',
  COMPLETED: 'bg-muted text-muted-foreground',
  EARLY_PAYOFF: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  EXCHANGED: 'bg-warning/10 text-warning',
  CLOSED_BAD_DEBT: 'bg-destructive/10 text-destructive',
};

const STATUS_OPTIONS = ['ALL', 'ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF', 'EXCHANGED'];

// ── Main Component ────────────────────────────────────────────────────────────

export default function FinancePortfolioPage() {
  useDocumentTitle('พอร์ตสัญญา FINANCE');
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const limit = 50;

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<PortfolioResponse>({
    queryKey: ['finance-portfolio', statusFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      const { data } = await api.get(`/reports/finance-portfolio?${params}`);
      return data;
    },
  });

  const columns = [
    {
      key: 'contractNumber',
      label: 'เลขสัญญา',
      render: (row: PortfolioContract) => (
        <div>
          <div className="font-medium text-primary hover:underline cursor-pointer">{row.contractNumber}</div>
          <div className="text-xs text-muted-foreground">{row.branch}</div>
        </div>
      ),
    },
    {
      key: 'customer',
      label: 'ลูกค้า',
      render: (row: PortfolioContract) => (
        <div>
          <div className="font-medium">{row.customer.name}</div>
          <div className="text-xs text-muted-foreground">{row.customer.phone || '-'}</div>
        </div>
      ),
    },
    {
      key: 'product',
      label: 'สินค้า',
      render: (row: PortfolioContract) => (
        <div>
          <div className="font-medium">
            {[row.product.brand, row.product.model].filter(Boolean).join(' ') || '-'}
          </div>
          {row.product.imeiSerial && (
            <div className="text-xs text-muted-foreground font-mono">{row.product.imeiSerial}</div>
          )}
        </div>
      ),
    },
    {
      key: 'financedAmount',
      label: 'ยอดจัด',
      render: (row: PortfolioContract) => (
        <div className="text-right">
          <div className="font-medium">{fmt(row.financedAmount)} ฿</div>
          <div className="text-xs text-muted-foreground">{fmt(row.monthlyPayment)} ฿/เดือน</div>
        </div>
      ),
    },
    {
      key: 'installments',
      label: 'งวด',
      render: (row: PortfolioContract) => (
        <div className="text-center">
          <div className="font-medium">{row.remainingInstallments}</div>
          <div className="text-xs text-muted-foreground">เหลือ / {row.totalMonths} งวด</div>
        </div>
      ),
    },
    {
      key: 'outstanding',
      label: 'ยอดค้าง',
      render: (row: PortfolioContract) => (
        <div className="text-right">
          <div
            className={`font-semibold ${
              row.outstanding > 0 ? 'text-destructive' : 'text-success'
            }`}
          >
            {fmt(row.outstanding)} ฿
          </div>
          {row.nextDueDate && (
            <div className="text-xs text-muted-foreground">
              ครบ {formatDateShort(row.nextDueDate)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (row: PortfolioContract) => (
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            STATUS_COLOR[row.status] || 'bg-muted text-muted-foreground'
          }`}
        >
          {STATUS_LABEL[row.status] || row.status}
        </span>
      ),
    },
  ];

  const summary = data?.summary;
  const aging = data?.aging;

  const summaryCards = [
    {
      label: 'สัญญาทั้งหมด',
      value: summary?.totalContracts ?? 0,
      isCount: true,
      icon: FileText,
      color: 'text-primary',
      iconBg: 'bg-primary/10',
      stripe: 'bg-primary',
    },
    {
      label: 'ยอดลูกหนี้รวม',
      value: summary?.totalReceivable ?? 0,
      isCount: false,
      icon: Banknote,
      color: 'text-blue-600',
      iconBg: 'bg-blue-100 dark:bg-blue-900/30',
      stripe: 'bg-blue-500',
    },
    {
      label: 'เก็บแล้ว',
      value: summary?.totalCollected ?? 0,
      isCount: false,
      icon: CheckCircle2,
      color: 'text-success',
      iconBg: 'bg-success/10',
      stripe: 'bg-success',
    },
    {
      label: 'คงเหลือ',
      value: summary?.totalOutstanding ?? 0,
      isCount: false,
      icon: Clock,
      color: 'text-warning',
      iconBg: 'bg-warning/10',
      stripe: 'bg-warning',
    },
    {
      label: 'อัตราเก็บเงิน',
      value: summary?.collectionRate ?? 0,
      isCount: false,
      isPercent: true,
      icon: TrendingUp,
      color: 'text-emerald-600',
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/30',
      stripe: 'bg-emerald-500',
    },
  ];

  const agingCards = [
    {
      label: 'ปกติ (ยังไม่ถึงกำหนด)',
      bucket: aging?.current,
      color: 'text-success',
      bg: 'bg-success/10',
      border: 'border-success/20',
      icon: CheckCircle2,
    },
    {
      label: 'ค้าง 1-30 วัน',
      bucket: aging?.days1to30,
      color: 'text-yellow-600',
      bg: 'bg-yellow-50 dark:bg-yellow-900/20',
      border: 'border-yellow-200 dark:border-yellow-800',
      icon: AlertTriangle,
    },
    {
      label: 'ค้าง 31-60 วัน',
      bucket: aging?.days31to60,
      color: 'text-orange-600',
      bg: 'bg-orange-50 dark:bg-orange-900/20',
      border: 'border-orange-200 dark:border-orange-800',
      icon: AlertTriangle,
    },
    {
      label: 'ค้าง 61-90 วัน',
      bucket: aging?.days61to90,
      color: 'text-red-500',
      bg: 'bg-red-50 dark:bg-red-900/20',
      border: 'border-red-200 dark:border-red-800',
      icon: ShieldAlert,
    },
    {
      label: 'ค้างเกิน 90 วัน',
      bucket: aging?.over90,
      color: 'text-destructive',
      bg: 'bg-destructive/10',
      border: 'border-destructive/20',
      icon: ShieldAlert,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="พอร์ตสัญญา BESTCHOICE FINANCE"
        subtitle="สัญญาผ่อนชำระที่ FINANCE ถือกรรมสิทธิ์"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {summaryCards.map((card) => (
          <Card key={card.label} className="overflow-hidden">
            <div className={`h-1 w-full ${card.stripe}`} />
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground truncate">{card.label}</p>
                  <p className={`mt-1 text-lg font-bold ${card.color}`}>
                    {card.isCount
                      ? card.value.toLocaleString('th-TH')
                      : card.isPercent
                      ? `${card.value.toFixed(1)}%`
                      : `${Number(card.value).toLocaleString('th-TH', { maximumFractionDigits: 0 })} ฿`}
                  </p>
                </div>
                <div className={`rounded-lg p-2 shrink-0 ${card.iconBg}`}>
                  <card.icon className={`h-4 w-4 ${card.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Aging Breakdown */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          การวิเคราะห์อายุหนี้ (Aging)
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {agingCards.map((card) => (
            <div
              key={card.label}
              className={`rounded-lg border p-4 ${card.bg} ${card.border}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <card.icon className={`h-4 w-4 ${card.color}`} />
                <p className="text-xs font-medium text-muted-foreground">{card.label}</p>
              </div>
              <p className={`text-lg font-bold ${card.color}`}>
                {card.bucket?.count ?? 0} งวด
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {fmt(card.bucket?.amount ?? 0)} ฿
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Filter + Table */}
      <Card>
        <CardContent className="p-0">
          {/* Status filter */}
          <div className="flex flex-wrap gap-2 p-4 border-b">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setStatusFilter(s);
                  setPage(1);
                }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {STATUS_LABEL[s] ?? s}
              </button>
            ))}
          </div>

          <QueryBoundary
            isLoading={isLoading}
            isError={isError}
            error={error}
            onRetry={refetch}
          >
            {data && (
              <>
                <DataTable
                  columns={columns}
                  data={data.data}
                  onRowClick={(row) => navigate(`/contracts/${row.id}`)}
                  emptyMessage="ไม่พบสัญญาที่ตรงกับเงื่อนไข"
                />
                {/* Pagination */}
                {data.total > limit && (
                  <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
                    <span>
                      แสดง {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} จาก{' '}
                      {data.total.toLocaleString('th-TH')} รายการ
                    </span>
                    <div className="flex gap-2">
                      <button
                        disabled={page === 1}
                        onClick={() => setPage((p) => p - 1)}
                        className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-muted transition-colors"
                      >
                        ก่อนหน้า
                      </button>
                      <button
                        disabled={page * limit >= data.total}
                        onClick={() => setPage((p) => p + 1)}
                        className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-muted transition-colors"
                      >
                        ถัดไป
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </QueryBoundary>
        </CardContent>
      </Card>
    </div>
  );
}
