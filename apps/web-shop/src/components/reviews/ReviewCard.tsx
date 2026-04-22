import type { Review } from '../../types/review';
import ReviewStars from './ReviewStars';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Props {
  review: Review;
}

export default function ReviewCard({ review }: Props) {
  const initial = review.customer.name?.trim().charAt(0) || '?';
  return (
    <Card variant="outlined" className="p-4 space-y-3 leading-snug">
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="size-10 rounded-full bg-zinc-100 text-zinc-600 flex items-center justify-center font-semibold text-sm shrink-0"
        >
          {initial}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm leading-snug">{review.customer.name}</span>
            {review.verified && (
              <Badge variant="success" size="sm">
                ซื้อจริง
              </Badge>
            )}
            <span className="text-xs text-muted-foreground leading-snug">
              · {new Date(review.createdAt).toLocaleDateString('th-TH')}
            </span>
          </div>
          <ReviewStars value={review.rating} />
        </div>
      </div>
      {review.title && <div className="font-semibold leading-snug">{review.title}</div>}
      {review.comment && (
        <p className="text-sm leading-snug line-clamp-4 md:line-clamp-none">{review.comment}</p>
      )}
      {review.photoUrl && (
        <img
          src={review.photoUrl}
          alt="รูปประกอบรีวิว"
          className="rounded-lg mt-2 max-h-64 object-contain"
          loading="lazy"
        />
      )}
    </Card>
  );
}
