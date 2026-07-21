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
import { usePageMeta } from '@/hooks/usePageMeta';
import ShopLayout from '@/components/layout/ShopLayout';
import ReviewsSection from '@/components/reviews/ReviewsSection';
import { InstallmentCalculatorCard } from '@/components/InstallmentCalculatorCard';
import type { ProductUnit } from '@/types/product';
import { Breadcrumb } from '@/components/catalog/Breadcrumb';
import { SpecTable } from '@/components/catalog/SpecTable';
import { UnitPicker } from '@/components/catalog/UnitPicker';
import { ImageLightbox } from '@/components/catalog/ImageLightbox';
import { Product360Viewer } from '@/components/catalog/Product360Viewer';
import { RelatedSection } from '@/components/catalog/RelatedSection';
import { StockIndicator } from '@/components/catalog/StockIndicator';
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

interface ProductDetail {
  id: string;
  brand: string;
  model: string;
  storage?: string;
  color?: string;
  category: string;
  condition: 'NEW' | 'USED';
  description?: string;
  gallery: string[];
  gallery360: string[];
  tiers: Record<string, { minPrice: number; maxPrice: number; units: ProductUnit[] }>;
  cashPrice: number | null;
  installmentPrice: number | null;
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
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [view360, setView360] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['shop-product', id],
    queryFn: () => api.get(`/api/shop/products/${id}`).then((r) => r.data as ProductDetail),
    enabled: !!id,
  });

  // Computed null-safely so this can sit above the early return below and
  // keep the installment-preview query (which re-keys off the selected
  // unit) unconditional per rules-of-hooks.
  const flatUnits: ProductUnit[] = data ? Object.values(data.tiers).flatMap((t) => t.units) : [];
  const cheapest = flatUnits.reduce<ProductUnit | undefined>(
    (min, u) => (min == null || u.cashPrice < min.cashPrice ? u : min),
    undefined,
  );
  const selectedUnit = flatUnits.find((u) => u.id === selectedUnitId) ?? cheapest;

  // Real "ผ่อนเริ่ม" figure from the pricing engine (12 งวด ดาวน์ 15% = default
  // shown in the calculator below) — never estimate with a made-up multiplier.
  // Re-keyed by the selected unit so the hero figure stays in sync with the
  // unit picker instead of a page-level representative price.
  const previewId = selectedUnit?.id ?? id;
  const { data: preview } = useQuery({
    queryKey: ['shop-product-preview', previewId],
    queryFn: () =>
      api
        .get(
          `/api/shop/installment-preview?productId=${previewId}&months=12&downPct=0.15&provider=BC`,
        )
        .then((r) => r.data as { available: boolean; monthlyPayment?: number }),
    enabled: !!previewId && !!selectedUnit?.installmentPrice,
  });

  useEffect(() => {
    if (data && id) {
      track('ViewContent', { content_type: 'product', content_ids: [id] });
    }
  }, [data, id, track]);

  // Hook must run every render (rules-of-hooks) — call before the loading
  // early-return below, with an undefined title while data hasn't arrived
  // yet (hook design tolerates that and swaps in the real name on re-render).
  const metaTitle = data
    ? [data.brand, data.model, data.storage, data.color].filter(Boolean).join(' ')
    : undefined;
  usePageMeta(
    metaTitle,
    metaTitle ? `${metaTitle} ผ่อนได้บัตรประชาชนใบเดียว รับประกันร้าน 30 วัน` : undefined,
  );

  const reserveMut = useMutation({
    mutationFn: () =>
      api
        .post('/api/shop/reservations', {
          productId: selectedUnit?.id ?? id,
          sessionId: getSessionId(),
        })
        .then((r) => r.data as { id: string; expiresAt: string }),
    onSuccess: (res) => {
      cart.setItem(res.id, selectedUnit?.id ?? id!);
      if (id) {
        track('AddToCart', {
          content_ids: [selectedUnit?.id ?? id],
          value: selectedUnit?.cashPrice ?? 0,
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

  const displayName = [data.brand, data.model, data.storage, data.color].filter(Boolean).join(' ');
  const price = selectedUnit?.cashPrice ?? 0;
  const monthlyFrom =
    preview?.available && preview.monthlyPayment ? Math.ceil(preview.monthlyPayment) : null;
  const gradeKeys = Object.keys(data.tiers);
  const isNew = data.condition === 'NEW';
  const showGrades = !isNew && gradeKeys.length > 0;
  const gallery =
    data.gallery && data.gallery.length > 0 ? data.gallery : [media('product.placeholder')];
  const mainImage = gallery[activeImage] ?? gallery[0];
  const has360 = data.gallery360.length > 0;
  const stockCount = flatUnits.length;

  return (
    <ShopLayout>
      <Container className="py-6 md:py-8">
        <Breadcrumb
          items={[
            { label: 'หน้าแรก', to: '/' },
            { label: 'สินค้าทั้งหมด', to: '/products' },
            { label: data.model },
          ]}
        />
        <div className="grid md:grid-cols-2 gap-8 leading-snug mt-3">
          {/* Gallery */}
          <div className="space-y-3">
            {has360 && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setView360(false)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    !view360
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-border text-muted-foreground hover:border-foreground/40'
                  }`}
                >
                  รูป
                </button>
                <button
                  type="button"
                  onClick={() => setView360(true)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    view360
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-border text-muted-foreground hover:border-foreground/40'
                  }`}
                >
                  360°
                </button>
              </div>
            )}
            {view360 && has360 ? (
              <Product360Viewer frames={data.gallery360} alt={displayName} />
            ) : (
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                aria-label="ดูรูปขยาย"
                className="aspect-square w-full rounded-2xl bg-zinc-50 overflow-hidden flex items-center justify-center cursor-zoom-in"
              >
                <img
                  src={mainImage}
                  alt={displayName}
                  className="max-h-full max-w-full object-contain"
                  loading="eager"
                />
              </button>
            )}
            {gallery.length > 1 && (
              <div className="grid grid-cols-5 gap-2">
                {gallery.map((src, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setView360(false);
                      setActiveImage(i);
                    }}
                    aria-label={`รูปที่ ${i + 1}`}
                    className={`aspect-square rounded-xl bg-zinc-50 overflow-hidden flex items-center justify-center border transition-all ${
                      i === activeImage && !view360
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
            <ImageLightbox
              images={gallery}
              open={lightboxOpen}
              index={activeImage}
              onOpenChange={setLightboxOpen}
              onIndexChange={setActiveImage}
              alt={displayName}
            />
          </div>

          {/* Details */}
          <Stack gap={4}>
            <h1 className="text-2xl md:text-3xl font-bold leading-snug">{displayName}</h1>

            <div className="flex flex-wrap gap-2 items-center">
              <Badge variant={isNew ? 'condition-a' : 'condition-b'} size="md">
                {isNew ? 'เครื่องใหม่ · มือ 1' : 'มือสอง · มือ 2'}
              </Badge>
              {showGrades &&
                gradeKeys.map((g) => (
                  <Badge key={g} variant={conditionVariant(g)} size="md">
                    เกรด {g}
                  </Badge>
                ))}
              {isNew && (
                <span className="text-xs text-muted-foreground leading-snug">
                  เครื่องใหม่ · ประกันศูนย์
                </span>
              )}
            </div>

            <UnitPicker
              units={flatUnits}
              selectedId={selectedUnit?.id ?? ''}
              onSelect={setSelectedUnitId}
              isNew={isNew}
            />

            <div className="space-y-1">
              <div className="flex flex-wrap items-baseline gap-2">
                {price > 0 ? (
                  <div className="text-3xl md:text-4xl font-bold text-emerald-600 leading-snug">
                    ฿{price.toLocaleString()}
                  </div>
                ) : (
                  <div className="text-2xl md:text-3xl font-semibold text-muted-foreground leading-snug">
                    สอบถามราคาทางไลน์
                  </div>
                )}
                {stockCount > 0 && (
                  <StockIndicator
                    display={
                      stockCount <= 3
                        ? `เหลือ ${stockCount} เครื่อง — ใกล้หมด`
                        : `เหลือ ${stockCount} เครื่อง`
                    }
                    tone={stockCount <= 3 ? 'urgent' : 'low'}
                  />
                )}
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

            {showGrades && (
              <ul className="space-y-1 text-sm text-muted-foreground leading-snug">
                {gradeKeys.map((g) => (
                  <li key={g}>{conditionDescription(g)}</li>
                ))}
              </ul>
            )}

            {selectedUnit && <SpecTable unit={selectedUnit} storage={data.storage} isNew={isNew} />}

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
              <Button
                variant="outline"
                size="lg"
                fullWidth
                onClick={() => nav(`/apply/${selectedUnit?.id ?? data.id}`)}
              >
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
            productId={selectedUnit?.id ?? data.id}
            cashPrice={selectedUnit?.cashPrice ?? data.cashPrice}
            installmentPrice={selectedUnit?.installmentPrice ?? data.installmentPrice}
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

      <Section padding="md">
        <RelatedSection productId={id!} />
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
            onClick={() => nav(`/apply/${selectedUnit?.id ?? data.id}`)}
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
