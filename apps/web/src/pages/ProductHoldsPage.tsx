import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import { Link } from 'react-router';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface HoldRow {
  id: string;
  productId: string;
  productName: string;
  imeiLast4: string | null;
  branchName: string | null;
  status: string;
  reservedAt: string;
  expiresAt: string;
  secondsRemaining: number;
  source: 'ORDER' | 'APPLICATION' | 'UNLINKED';
  orderNumber: string | null;
  applicationNumber: string | null;
  customerName: string | null;
}

const SOURCE_LABEL: Record<HoldRow['source'], string> = {
  ORDER: 'มีคำสั่งซื้อ',
  APPLICATION: 'ใบสมัครผ่อน',
  UNLINKED: 'ยังไม่ผูก (จองจากเว็บ)',
};

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return 'หมดเวลาแล้ว';
  const m = Math.floor(seconds / 60);
  if (m >= 60) return `เหลือ ${Math.floor(m / 60)} ชม. ${m % 60} น.`;
  return `เหลือ ${m} นาที`;
}

export default function ProductHoldsPage() {
  useDocumentTitle('การจองจากเว็บ');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canRelease = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  const { data, isLoading, isError, error, refetch } = useQuery<HoldRow[]>({
    queryKey: ['product-holds', 'ACTIVE'],
    queryFn: async () => {
      const res = await api.get('/admin/product-holds', { params: { status: 'ACTIVE' } });
      return res.data as HoldRow[];
    },
    refetchInterval: 30_000,
  });

  const releaseMutation = useMutation({
    mutationFn: async (id: string) => api.patch(`/admin/product-holds/${id}/release`),
    onSuccess: () => {
      toast.success('ปลดการจองเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['product-holds'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const holds = data ?? [];

  return (
    <div>
      <PageHeader
        title="การจองจากเว็บ"
        subtitle="เครื่องที่ลูกค้าเว็บกำลังถือสิทธิ์อยู่ — ปลดได้เมื่อลูกค้าไม่มาจริง"
        icon={<Lock className="size-5" />}
      />

      <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={refetch}>
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left font-medium">เครื่อง</th>
                <th className="px-4 py-3 text-left font-medium">สาขา</th>
                <th className="px-4 py-3 text-left font-medium">ที่มา</th>
                <th className="px-4 py-3 text-left font-medium">ลูกค้า</th>
                <th className="px-4 py-3 text-left font-medium">เวลาที่เหลือ</th>
                <th className="px-4 py-3 text-left font-medium">การดำเนินการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {holds.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground leading-snug">
                    ตอนนี้ไม่มีเครื่องที่ถูกจองจากเว็บ
                  </td>
                </tr>
              ) : (
                holds.map((h) => (
                  <tr key={h.id} className="hover:bg-accent/30">
                    <td className="px-4 py-3">
                      <Link
                        to={`/products/${h.productId}`}
                        className="text-primary hover:underline leading-snug"
                      >
                        {h.productName}
                      </Link>
                      {h.imeiLast4 && (
                        <div className="text-xs text-muted-foreground leading-snug">
                          IMEI ••••{h.imeiLast4}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{h.branchName ?? '-'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={h.source === 'UNLINKED' ? 'secondary' : 'primary'}>
                        {SOURCE_LABEL[h.source]}
                      </Badge>
                      {(h.orderNumber || h.applicationNumber) && (
                        <div className="text-xs text-muted-foreground leading-snug">
                          {h.orderNumber ?? h.applicationNumber}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-foreground leading-snug">
                      {h.customerName ?? <span className="text-muted-foreground">ไม่ระบุ</span>}
                    </td>
                    <td className="px-4 py-3 text-foreground">{formatRemaining(h.secondsRemaining)}</td>
                    <td className="px-4 py-3">
                      {canRelease ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => releaseMutation.mutate(h.id)}
                          disabled={releaseMutation.isPending}
                        >
                          ปลดการจอง
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground leading-snug">
                          แจ้งผู้จัดการเพื่อปลด
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </QueryBoundary>
    </div>
  );
}
