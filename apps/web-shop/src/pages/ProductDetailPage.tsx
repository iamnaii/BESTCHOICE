import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { getSessionId } from '@/lib/session';
import { copy, lineOaMessageUrl } from '@/lib/copy';
import { media } from '@/lib/media-placeholders';
import { useCartStore } from '@/stores/cartStore';
import { useTrackEvent } from '@/hooks/useTrackEvent';
import ShopLayout from '@/components/layout/ShopLayout';
import ReviewsSection from '@/components/reviews/ReviewsSection';
import { InstallmentCalculatorCard } from '@/components/InstallmentCalculatorCard';
import {
  Container,
  Section,
  Stack,
  Button,
  Badge,
  TrustStrip,
  Skeleton,
  StickyBottomBar,
  StickyBottomBarSpacer,
} from '@/components';

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
  cashPrice: number | null;
  installmentPrice: number | null;
}

function lowestPrice(tiers: ProductDetail['tiers']): number {
  const prices = Object.values(tiers).map((t) => t.minPrice);
  return prices.length ? Math.min(...prices) : 0;
}

function conditionVariant(g: string): 'condition-a' | 'condition-b' | 'condition-c' {
  return g === 'A' ? 'condition-a' : g === 'B' ? 'condition-b' : 'condition-c';
}

function conditionDescription(g: string): string {
  return g === 'A'
    ? copy.product.conditionAFull
    : g === 'B'
      ? copy.product.conditionBFull
      : copy.product.conditionCFull;
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const cart = useCartStore();
  const track = useTrackEvent();
  const [activeImage, setActiveImage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['shop-product', id],
    queryFn: () =>
      api.get(`/api/shop/products/${id}`).then((r) => r.data as ProductDetail),
    enabled: !!id,
  });

  // Real "ผ่อนเริ่ม" figure from the pricing engine (12 งวด ดาวน์ 15% = default
  // shown in the calculator below) — never estimate with a made-up multiplier.
  const { data: preview } = useQuery({
    queryKey: ['shop-product-preview', id],
    queryFn: () =>
      api
        .get(`/api/shop/installment-preview?productId=${id}&months=12&downPct=0.15&provider=BC`)
        .then((r) => r.data as { available: boolean; monthlyPayment?: number }),
    enabled: !!id && !!data?.installmentPrice,
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
        <Container className="py-8">
          <div className="grid md:grid-cols-2 gap-8 leading-snug">
            <Skeleton className="aspect-square w-full rounded-2xl" />
            <div className="space-y-4">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-10 w-1/3" />
              <Skeleton className="h-20 w-full" />
            </div>
          </div>
        </Container>
      </ShopLayout>
    );
  }

  const displayName = [data.brand, data.model, data.storage, data.color]
    .filter(Boolean)
    .join(' ');
  const price = lowestPrice(data.tiers);
  const monthlyFrom =
    preview?.available && preview.monthlyPayment ? Math.ceil(preview.monthlyPayment) : null;
  const gradeKeys = Object.keys(data.tiers);
  const gallery = data.gallery && data.gallery.length > 0 ? data.gallery : [media('product.placeholder')];
  const mainImage = gallery[activeImage] ?? gallery[0];

  return (
    <ShopLayout>
      <Container className="py-6 md:py-8">
        <div className="grid md:grid-cols-2 gap-8 leading-snug">
          {/* Gallery */}
          <div className="space-y-3">
            <div className="aspect-square w-full rounded-2xl bg-zinc-50 overflow-hidden flex items-center justify-center">
              <img
                src={mainImage}
                alt={displayName}
                className="max-h-full max-w-full object-contain"
                loading="eager"
              />
            </div>
            {gallery.length > 1 && (
              <div className="grid grid-cols-5 gap-2">
                {gallery.slice(0, 5).map((src, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveImage(i)}
                    aria-label={`รูปที่ ${i + 1}`}
                    className={`aspect-square rounded-xl bg-zinc-50 overflow-hidden flex items-center justify-center border transition-all ${
                      i === activeImage
                        ? 'border-emerald-500 ring-2 ring-emerald-200'
                        : 'border-zinc-200 hover:border-emerald-200'
                    }`}
                  >
                    <img
                      src={src}
                      alt={`${displayName} ${i + 1}`}
                      className="max-h-full max-w-full object-contain"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <Stack gap={4}>
            <h1 className="text-2xl md:text-3xl font-bold leading-snug">{displayName}</h1>

            {gradeKeys.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {gradeKeys.map((g) => (
                  <Badge key={g} variant={conditionVariant(g)} size="md">
                    เกรด {g}
                  </Badge>
                ))}
              </div>
            )}

            <div className="space-y-1">
              <div className="text-3xl md:text-4xl font-bold text-emerald-600 leading-snug">
                ฿{price.toLocaleString()}
              </div>
              {monthlyFrom && (
                <div className="text-base font-semibold text-emerald-700 leading-snug">
                  ผ่อนเริ่ม ฿{monthlyFrom.toLocaleString()}/เดือน
                  <span className="text-xs font-normal text-muted-foreground">
                    {' '}
                    (12 งวด ดาวน์ 15%)
                  </span>
                </div>
              )}
            </div>

            {gradeKeys.length > 0 && (
              <ul className="space-y-1 text-sm text-muted-foreground leading-snug">
                {gradeKeys.map((g) => (
                  <li key={g}>{conditionDescription(g)}</li>
                ))}
              </ul>
            )}

            {data.description && (
              <p className="text-sm md:text-base text-muted-foreground leading-snug">
                {data.description}
              </p>
            )}

            {/* Desktop primary CTA (mobile uses StickyBottomBar) */}
            <div className="hidden md:flex flex-col gap-3 pt-2">
              <Button
                variant="cta"
                size="lg"
                fullWidth
                onClick={() => reserveMut.mutate()}
                disabled={reserveMut.isPending}
                loading={reserveMut.isPending}
              >
                {copy.product.reserveCta}
              </Button>
              <Button variant="outline" size="lg" fullWidth onClick={() => nav(`/apply/${data.id}`)}>
                สมัครผ่อนทันที
              </Button>
              <a
                href={lineOaMessageUrl(`สนใจ ${displayName} ครับ/ค่ะ`)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 text-sm text-emerald-700 hover:underline underline-offset-4 leading-snug"
              >
                <MessageCircle className="size-4" aria-hidden="true" />
                {copy.product.askLineCta}
              </a>
            </div>
          </Stack>
        </div>
      </Container>

      <Section padding="md">
        <Container>
          <InstallmentCalculatorCard
            productId={data.id}
            cashPrice={data.cashPrice ?? null}
            installmentPrice={data.installmentPrice ?? null}
          />
        </Container>
      </Section>

      <Section tone="muted" padding="sm">
        <Container>
          <TrustStrip />
        </Container>
      </Section>

      <Section padding="md">
        <Container>
          <ReviewsSection productId={id!} />
        </Container>
      </Section>

      {/* Mobile sticky CTA — installment customers are the majority; give
         "สมัครผ่อน" equal billing with reserve instead of burying it above the fold */}
      <StickyBottomBar>
        <div className="flex gap-2">
          <Button
            variant="cta"
            size="lg"
            className="flex-1"
            onClick={() => reserveMut.mutate()}
            disabled={reserveMut.isPending}
            loading={reserveMut.isPending}
          >
            {copy.product.reserveCta}
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="flex-1"
            onClick={() => nav(`/apply/${data.id}`)}
          >
            สมัครผ่อน
          </Button>
        </div>
      </StickyBottomBar>
      <StickyBottomBarSpacer />
      <div className="md:hidden text-center py-3">
        <a
          href={lineOaMessageUrl(`สนใจ ${displayName} ครับ/ค่ะ`)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 text-sm text-emerald-700 hover:underline underline-offset-4 leading-snug"
        >
          <MessageCircle className="size-4" aria-hidden="true" />
          {copy.product.askLineCta}
        </a>
      </div>
    </ShopLayout>
  );
}
