import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { getSessionId } from '../lib/session';
import { useCartStore } from '../stores/cartStore';
import { useTrackEvent } from '../hooks/useTrackEvent';
import ShopLayout from '../components/layout/ShopLayout';
import { Button } from '../components/ui/button';
import ReviewsSection from '../components/reviews/ReviewsSection';

interface ProductUnit {
  id: string;
  conditionGrade: string;
  batteryHealth?: number;
  hasBox?: boolean;
  hasCharger?: boolean;
  hasHeadphones?: boolean;
  shopWarrantyDays?: number;
  costPrice: number;
  imeiPartial?: string;
  gallery: string[];
  gallery360: string[];
}

interface ProductDetail {
  id: string;
  brand: string;
  model: string;
  storage?: string;
  color?: string;
  category: string;
  description?: string;
  gallery: string[];
  gallery360: string[];
  tiers: Record<string, { minPrice: number; maxPrice: number; units: ProductUnit[] }>;
}

function lowestPrice(tiers: ProductDetail['tiers']): number {
  const prices = Object.values(tiers).map((t) => t.minPrice);
  return prices.length ? Math.min(...prices) : 0;
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const cart = useCartStore();
  const track = useTrackEvent();

  const { data, isLoading } = useQuery({
    queryKey: ['shop-product', id],
    queryFn: () =>
      api.get(`/api/shop/products/${id}`).then((r) => r.data as ProductDetail),
    enabled: !!id,
  });

  useEffect(() => {
    if (data && id) {
      track('ViewContent', { content_type: 'product', content_ids: [id] });
    }
  }, [data, id, track]);

  const reserveMut = useMutation({
    mutationFn: () =>
      api
        .post('/api/shop/reservations', { productId: id, sessionId: getSessionId() })
        .then((r) => r.data as { id: string; expiresAt: string }),
    onSuccess: (res) => {
      cart.setItem(res.id, id!);
      if (id) {
        track('AddToCart', {
          content_ids: [id],
          value: lowestPrice(data?.tiers ?? {}),
          currency: 'THB',
        });
      }
      toast.success('จองเครื่องนี้ไว้ 15 นาทีแล้ว');
      nav('/cart');
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      toast.error(e.response?.data?.message ?? 'จองไม่สำเร็จ');
    },
  });

  if (isLoading || !data) {
    return (
      <ShopLayout>
        <div className="p-8 text-muted-foreground leading-snug">กำลังโหลด...</div>
      </ShopLayout>
    );
  }

  const displayName = [data.brand, data.model, data.storage, data.color]
    .filter(Boolean)
    .join(' ');
  const price = lowestPrice(data.tiers);
  const monthlyEst = Math.floor(price * 0.093);
  const gradeKeys = Object.keys(data.tiers);

  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 grid md:grid-cols-2 gap-8">
        <div>
          {data.gallery?.[0] && (
            <img
              src={data.gallery[0]}
              alt={displayName}
              className="w-full rounded-2xl bg-muted"
            />
          )}
          {data.gallery && data.gallery.length > 1 && (
            <div className="grid grid-cols-4 gap-2 mt-2">
              {data.gallery.slice(1, 5).map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`${displayName} ${i + 2}`}
                  className="w-full rounded-lg bg-muted"
                />
              ))}
            </div>
          )}
        </div>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold leading-snug">{displayName}</h1>
          {gradeKeys.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {gradeKeys.map((g) => (
                <span
                  key={g}
                  className="inline-block rounded-full bg-primary/10 text-primary px-3 py-1 text-sm leading-snug"
                >
                  เกรด {g}
                </span>
              ))}
            </div>
          )}
          {data.description && (
            <p className="text-muted-foreground leading-snug">{data.description}</p>
          )}
          <div className="text-3xl font-bold text-primary leading-snug">
            ฿{price.toLocaleString()}
          </div>
          <Button
            size="lg"
            className="w-full"
            onClick={() => reserveMut.mutate()}
            disabled={reserveMut.isPending}
          >
            {reserveMut.isPending ? 'กำลังจอง...' : 'ซื้อเลย (จอง 15 นาที)'}
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={() => nav('/apply')}
          >
            ผ่อนเริ่ม ฿{monthlyEst.toLocaleString()} / เดือน
          </Button>
        </div>
      </div>
      <div className="container mx-auto px-4 pb-8">
        <ReviewsSection productId={id!} />
      </div>
    </ShopLayout>
  );
}
