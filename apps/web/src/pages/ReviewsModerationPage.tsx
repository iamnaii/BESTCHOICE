import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Star, Eye, EyeOff, MessageSquare } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDateShort } from '@/utils/formatters';

type ReviewStatus = 'PUBLISHED' | 'HIDDEN' | 'FLAGGED';

interface Review {
  id: string;
  productId: string;
  product?: { id: string; name: string } | null;
  customerId: string;
  customer?: { id: string; name: string } | null;
  rating: number;
  title?: string | null;
  comment?: string | null;
  verified: boolean;
  status: ReviewStatus;
  hiddenReason?: string | null;
  createdAt: string;
}

interface ReviewsResponse {
  data: Review[];
  total?: number;
}

const STATUS_TABS: Array<{ key: ReviewStatus | 'ALL'; label: string }> = [
  { key: 'ALL', label: 'ทั้งหมด' },
  { key: 'PUBLISHED', label: 'แสดงบนหน้าร้าน' },
  { key: 'FLAGGED', label: 'ถูกรายงาน' },
  { key: 'HIDDEN', label: 'ซ่อนแล้ว' },
];

const STATUS_BADGE: Record<ReviewStatus, { label: string; variant: 'success' | 'warning' | 'secondary' }> = {
  PUBLISHED: { label: 'แสดงบนหน้าร้าน', variant: 'success' },
  FLAGGED: { label: 'ถูกรายงาน', variant: 'warning' },
  HIDDEN: { label: 'ซ่อนแล้ว', variant: 'secondary' },
};

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`size-3.5 ${
            n <= rating ? 'fill-warning text-warning' : 'text-muted-foreground/40'
          }`}
        />
      ))}
    </div>
  );
}

export default function ReviewsModerationPage() {
  useDocumentTitle('รีวิวจากลูกค้า');
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | 'ALL'>('ALL');
  const [productIdFilter, setProductIdFilter] = useState('');
  const [hideInputs, setHideInputs] = useState<Record<string, string>>({});

  const { data, isLoading, isError, error, refetch } = useQuery<ReviewsResponse>({
    queryKey: ['admin-reviews', statusFilter, productIdFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (productIdFilter.trim()) params.set('productId', productIdFilter.trim());
      const qs = params.toString();
      const res = await api.get(`/admin/reviews${qs ? `?${qs}` : ''}`);
      const body = res.data;
      if (Array.isArray(body)) return { data: body, total: body.length };
      return body;
    },
  });

  const hideMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) =>
      api.patch(`/admin/reviews/${id}/hide`, reason ? { reason } : {}),
    onSuccess: (_d, vars) => {
      toast.success('ซ่อนรีวิวเรียบร้อย');
      setHideInputs((prev) => {
        const next = { ...prev };
        delete next[vars.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => api.patch(`/admin/reviews/${id}/restore`),
    onSuccess: () => {
      toast.success('กู้คืนรีวิวเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const reviews = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="รีวิวจากลูกค้า"
        subtitle="ตรวจสอบและดูแลรีวิวก่อนเผยแพร่บนหน้าร้านออนไลน์"
        icon={<MessageSquare className="size-5" />}
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`px-3 py-1.5 rounded-md text-sm leading-snug transition-colors ${
                statusFilter === tab.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            variant="sm"
            placeholder="กรองด้วย Product ID"
            value={productIdFilter}
            onChange={(e) => setProductIdFilter(e.target.value)}
            className="w-60"
          />
        </div>
      </div>

      <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={refetch}>
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left font-medium">วันที่</th>
                <th className="px-4 py-3 text-left font-medium">สินค้า</th>
                <th className="px-4 py-3 text-left font-medium">ลูกค้า</th>
                <th className="px-4 py-3 text-left font-medium">คะแนน</th>
                <th className="px-4 py-3 text-left font-medium">รีวิว</th>
                <th className="px-4 py-3 text-left font-medium">สถานะ</th>
                <th className="px-4 py-3 text-left font-medium">การดำเนินการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {reviews.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    ไม่มีรีวิวในสถานะนี้
                  </td>
                </tr>
              ) : (
                reviews.map((review) => {
                  const badge = STATUS_BADGE[review.status];
                  const hideReason = hideInputs[review.id] ?? '';
                  return (
                    <tr key={review.id} className="hover:bg-accent/30 align-top">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDateShort(review.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-foreground leading-snug">
                        {review.product?.name ?? '-'}
                      </td>
                      <td className="px-4 py-3 text-foreground leading-snug">
                        {review.customer?.name ?? '-'}
                        {review.verified && (
                          <div className="mt-0.5">
                            <Badge variant="info" size="xs">ซื้อจริง</Badge>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Stars rating={review.rating} />
                      </td>
                      <td className="px-4 py-3 text-foreground leading-snug max-w-[360px]">
                        {review.title && <div className="font-medium">{review.title}</div>}
                        {review.comment && (
                          <div className="text-xs text-muted-foreground line-clamp-3">
                            {review.comment}
                          </div>
                        )}
                        {review.hiddenReason && (
                          <div className="text-xs text-destructive mt-1">
                            เหตุซ่อน: {review.hiddenReason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {badge ? (
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        ) : (
                          <Badge variant="secondary">{review.status}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-2 min-w-[220px]">
                          {(review.status === 'PUBLISHED' || review.status === 'FLAGGED') && (
                            <div className="flex gap-1.5">
                              <Input
                                variant="sm"
                                placeholder="เหตุผล (ไม่บังคับ)"
                                value={hideReason}
                                onChange={(e) =>
                                  setHideInputs((prev) => ({
                                    ...prev,
                                    [review.id]: e.target.value,
                                  }))
                                }
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  hideMutation.mutate({
                                    id: review.id,
                                    reason: hideReason.trim() || undefined,
                                  })
                                }
                                disabled={hideMutation.isPending}
                              >
                                <EyeOff className="size-4 mr-1.5" />
                                ซ่อน
                              </Button>
                            </div>
                          )}
                          {review.status === 'HIDDEN' && (
                            <Button
                              size="sm"
                              onClick={() => restoreMutation.mutate(review.id)}
                              disabled={restoreMutation.isPending}
                            >
                              <Eye className="size-4 mr-1.5" />
                              กู้คืน
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </QueryBoundary>
    </div>
  );
}
