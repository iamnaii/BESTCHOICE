import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Clock, Inbox } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { usePaginationParams } from '@/hooks/usePaginationParams';
import { PaginationBar } from '@/components/ui/PaginationBar';
import { otherIncomeApi } from '@/lib/otherIncome';
import { formatThaiDateShort } from '@/lib/date';
import { formatNumberDecimal } from '@/utils/formatters';

export default function OtherIncomePendingApprovalPage() {
  const navigate = useNavigate();
  const { page, size, setPage, setSize } = usePaginationParams({ defaultSize: 50 });

  const query = useQuery({
    queryKey: ['other-income', 'list', { status: 'READY', page, size }],
    queryFn: () =>
      otherIncomeApi.list({ status: 'READY', limit: size, page, sort: 'createdAt:asc' }),
  });

  const data = query.data;
  const total = data?.total ?? 0;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="เอกสารรออนุมัติ"
        subtitle="รายได้อื่น"
        icon={<Clock size={20} />}
        onBack={() => navigate('/other-income')}
      />
      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={query.refetch}
      >
        {data && data.data.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Inbox className="mx-auto mb-3 opacity-50" size={40} />
            <p>ไม่มีเอกสารรออนุมัติ</p>
          </div>
        ) : (
          <div className="rounded-xl border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">เลขที่</th>
                  <th className="px-4 py-2 text-left">วันที่</th>
                  <th className="px-4 py-2 text-left">ผู้ติดต่อ</th>
                  <th className="px-4 py-2 text-right">ยอดรับ</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(data?.data ?? []).map((d) => (
                  <tr
                    key={d.id}
                    className="border-t hover:bg-accent/30 cursor-pointer"
                    onClick={() => navigate(`/other-income/${d.id}`)}
                  >
                    <td className="px-4 py-2 font-mono font-semibold text-primary">{d.docNumber}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {formatThaiDateShort(d.issueDate)}
                    </td>
                    <td className="px-4 py-2">
                      {d.counterpartyName ?? d.customer?.name ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {formatNumberDecimal(d.amountReceived)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Clock size={14} className="inline text-warning" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <PaginationBar
          total={total}
          page={page}
          size={size}
          onPageChange={setPage}
          onSizeChange={setSize}
        />
      </QueryBoundary>
    </div>
  );
}
