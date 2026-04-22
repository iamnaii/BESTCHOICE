import type { Review } from '../../types/review';
import ReviewStars from './ReviewStars';

interface Props {
  review: Review;
}

export default function ReviewCard({ review }: Props) {
  return (
    <div className="rounded-xl border border-border p-4 space-y-2 leading-snug">
      <div className="flex items-center justify-between">
        <ReviewStars value={review.rating} />
        {review.verified && (
          <span className="text-xs text-primary font-medium leading-snug">ซื้อจริง</span>
        )}
      </div>
      {review.title && <div className="font-semibold leading-snug">{review.title}</div>}
      {review.comment && <p className="text-sm leading-snug">{review.comment}</p>}
      <div className="text-xs text-muted-foreground leading-snug">
        {review.customer.name} · {new Date(review.createdAt).toLocaleDateString('th-TH')}
      </div>
    </div>
  );
}
