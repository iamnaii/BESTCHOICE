import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import type { Review, ReviewSummary } from '../../types/review';
import ReviewCard from './ReviewCard';
import ReviewStars from './ReviewStars';
import CreateReviewForm from './CreateReviewForm';

export default function ReviewsSection({ productId }: { productId: string }) {
  const { customer } = useAuth();

  const reviews = useQuery({
    queryKey: ['reviews', productId],
    queryFn: () => api.get(`/api/shop/reviews/${productId}`).then((r) => r.data as Review[]),
    enabled: !!productId,
  });

  const summary = useQuery({
    queryKey: ['reviews-summary', productId],
    queryFn: () =>
      api.get(`/api/shop/reviews/${productId}/summary`).then((r) => r.data as ReviewSummary),
    enabled: !!productId,
  });

  return (
    <section className="space-y-4 leading-snug">
      <h2 className="text-xl font-bold leading-snug">รีวิวจากผู้ซื้อจริง</h2>
      {summary.data && summary.data.total > 0 && (
        <div className="flex items-center gap-3">
          <ReviewStars value={Math.round(summary.data.average)} />
          <span className="text-sm text-muted-foreground leading-snug">
            {summary.data.average} จาก {summary.data.total} รีวิว
          </span>
        </div>
      )}
      <div className="space-y-3">
        {(reviews.data ?? []).map((r) => (
          <ReviewCard key={r.id} review={r} />
        ))}
        {reviews.data && reviews.data.length === 0 && (
          <div className="text-sm text-muted-foreground leading-snug">
            ยังไม่มีรีวิว — เป็นคนแรกที่รีวิวสินค้านี้
          </div>
        )}
      </div>
      {customer && <CreateReviewForm productId={productId} />}
    </section>
  );
}
