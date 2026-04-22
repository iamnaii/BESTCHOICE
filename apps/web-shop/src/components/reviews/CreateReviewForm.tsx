import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import ReviewStars from './ReviewStars';

export default function CreateReviewForm({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');

  const mut = useMutation({
    mutationFn: () =>
      api
        .post('/api/shop/reviews', {
          productId,
          rating,
          title: title.trim() || undefined,
          comment: comment.trim() || undefined,
        })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews', productId] });
      qc.invalidateQueries({ queryKey: ['reviews-summary', productId] });
      setTitle('');
      setComment('');
      toast.success('ขอบคุณสำหรับรีวิว');
    },
    onError: (e: { response?: { status?: number; data?: { message?: string } } }) => {
      toast.error(e.response?.data?.message ?? 'รีวิวไม่สำเร็จ');
    },
  });

  return (
    <div className="rounded-xl border border-border p-4 space-y-3 leading-snug">
      <div className="font-semibold leading-snug">เขียนรีวิว</div>
      <ReviewStars value={rating} onChange={setRating} size={28} />
      <Input
        placeholder="หัวข้อ (ถ้ามี)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-snug focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:border-ring"
        placeholder="รีวิวของคุณ"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
      />
      <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
        {mut.isPending ? 'กำลังส่ง...' : 'ส่งรีวิว'}
      </Button>
    </div>
  );
}
