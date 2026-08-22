import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AxiosError } from 'axios';
import { MessageCircle, Share2 } from 'lucide-react';
import { api } from '@/lib/api';
import { getSessionId } from '@/lib/session';
import {
  copy,
  lineOaMessageUrl,
  lineProductPrefill,
  messengerRefUrl,
  productShareUrl,
} from '@/lib/copy';
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

  // Reset per-product UI state on navigation between products (RelatedSection
  // links keep this component mounted, so stale hero image / 360 mode /
  // selected unit would otherwise carry over to the new product).
  useEffect(() => {
    setActiveImage(0);
    setSelectedUnitId(null);
    setView360(false);
    setLightboxOpen(false);
  }, [id]);

  const { data, isLoading, isError, isFetching, error, refetch } = useQuery({
    queryKey: ['shop-product', id],
    queryFn: () => api.get(`/api/shop/products/${id}`).then((r) => r.data as ProductDetail),
    enabled: !!id,
    // B0: 404 (readiness-filtered/sold-out) is a real, permanent outcome — never retry
    // it (matches ApplyStatusPage.tsx's notFound pattern). Transient errors (429 from
    // ShopBotDefenseGuard, 5xx, network hiccup) get 2 retries with backoff before the
    // generic error branch below offers a manual "ลองใหม่".
    retry: (failureCount, err) => (err as AxiosError)?.response?.status !== 404 && failureCount < 2,
  });

  // Fix round 1/5: only 404 means "this product is really gone" — other errors
  // (bot-defense 429, 5xx, network) must NOT show the same "ขายไปแล้ว" copy.
  const notFound = (error as AxiosError | null)?.response?.status === 404;

  // page handle ของ Messenger มาจาก IntegrationConfig (เจ้าของกรอกเองได้จากหน้า
  // Settings) ไม่ใช่ค่าคงที่ในซอร์ส — ยังไม่ตั้งค่า = ปุ่มถูกซ่อนโดยไม่พังหน้า
  const { data: shopConfig } = useQuery({
    queryKey: ['shop', 'public-config', 'shop'],
    queryFn: () =>
      api
        .get<{ facebookPageHandle: string | null }>('/api/shop/public-config/shop')
        .then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // Computed null-safely so this can sit above the early return below and
  // keep the installment-preview query (which re-keys off the selected
  // unit) unconditional per rules-of-hooks.
  const flatUnits: ProductUnit[] = data ? Object.values(data.tiers).flatMap((t) => t.units) : [];
  const cheapest = flatUnits.reduce<ProductUnit | undefined>(
    (min, u) => (min == null || u.cashPrice < min.cashPrice ? u : min),
    undefined,
  );
  // Falling back to `id` matters now that the grid lists second-hand stock one
  // card per device: /products/<thatDeviceId> must open on THAT device.
  const selectedUnit = flatUnits.find((u) => u.id === (selectedUnitId ?? id)) ?? cheapest;

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

  // สลับเครื่องแล้ว gallery เป็นคนละชุด — index เดิมอาจชี้เกินขอบ/ชี้รูปเครื่องอื่น
  useEffect(() => {
    setActiveImage(0);
    setView360(false);
  }, [selectedUnitId]);

  // Hook must run every render (rules-of-hooks) — call before the loading
  // early-return below, with an undefined title while data hasn't arrived
  // yet (hook design tolerates that and swaps in the real name on re-render).
  const metaTitle = data
    ? [data.brand, data.model, data.storage, data.color].filter(Boolean).join(' ')
    : undefined;
  const metaWarrantyDays =
    flatUnits.find((u) => u.shopWarrantyDays != null)?.shopWarrantyDays ?? null;
  usePageMeta(
    metaTitle,
    metaTitle
      ? `${metaTitle} ผ่อนได้บัตรประชาชนใบเดียว${metaWarrantyDays != null ? ` รับประกันร้าน ${metaWarrantyDays} วัน` : ''}`
      : undefined,
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
          value: selectedUnit?.cashPrice ?? undefined,
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

  // B0: head query ของ getProductDetail ผ่าน readiness แล้ว → controller ตอบ 404 ได้จริง
  // ถ้ายังรวม error เข้ากับ loading ลิงก์ที่ส่งลูกค้าจะเป็น Skeleton หมุนค้างตลอดกาล
  //
  // Fix round 1/5 [Important 1]: `isError` alone เหมารวมทุก error (403/429 บอทดีเฟนส์,
  // 5xx, เน็ตหลุด) ว่าเป็น "สินค้าขายไปแล้ว" — ผิด. แยกด้วย `notFound` (403/429/5xx เข้าการ์ด
  // error ทั่วไปพร้อมปุ่มลองใหม่แทน) และเช็ค `!data` กันไม่ให้ refetchOnReconnect ที่พังชั่วคราว
  // ไล่ที่หน้าสินค้าที่กำลังโชว์อยู่ (data ยังอยู่ใน cache) ออกไปเป็นหน้า error ทั้งที่ข้อมูลพร้อมอยู่แล้ว.
  if (isError && !data) {
    return (
      <ShopLayout>
        <Container className="py-16">
          <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8 text-center leading-snug">
            {notFound ? (
              <>
                <h1 className="text-xl font-semibold text-foreground">
                  สินค้านี้ไม่พร้อมขายบนเว็บ
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  เครื่องนี้อาจขายไปแล้ว หรือข้อมูลยังไม่ครบสำหรับขายออนไลน์ — ทักแชทมาได้เลย
                  ทีมงานช่วยหาเครื่องรุ่นเดียวกันให้ครับ
                </p>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                  <Button asChild variant="cta" size="lg">
                    <a
                      href={lineOaMessageUrl(`สนใจสินค้ารหัส ${id ?? ''} ครับ/ค่ะ`)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      ทักแชทสอบถาม
                    </a>
                  </Button>
                  <Button asChild variant="outline" size="lg">
                    <Link to="/products">ดูสินค้าทั้งหมด</Link>
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h1 className="text-xl font-semibold text-foreground">{copy.common.error}</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  โหลดข้อมูลสินค้าไม่สำเร็จ อาจเป็นเพราะเน็ตหลุดหรือระบบขัดข้องชั่วคราว
                  ลองใหม่อีกครั้งได้เลย
                </p>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                  <Button
                    variant="cta"
                    size="lg"
                    onClick={() => refetch()}
                    disabled={isFetching}
                    loading={isFetching}
                  >
                    {copy.common.retry}
                  </Button>
                  <Button asChild variant="outline" size="lg">
                    <Link to="/products">ดูสินค้าทั้งหมด</Link>
                  </Button>
                </div>
              </>
            )}
          </div>
        </Container>
      </ShopLayout>
    );
  }

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
  const price = selectedUnit?.cashPrice ?? null;
  const monthlyFrom =
    preview?.available && preview.monthlyPayment ? Math.ceil(preview.monthlyPayment) : null;
  const gradeKeys = Object.keys(data.tiers);
  const isNew = data.condition === 'NEW';
  const showGrades = !isNew && gradeKeys.length > 0;
  // รูปตามเครื่องที่เลือก — ถอยไปใช้รูประดับรุ่นเมื่อเครื่องนั้นยังไม่มีรูปของตัวเอง
  const unitGallery = selectedUnit?.gallery ?? [];
  const gallerySource = unitGallery.length > 0 ? unitGallery : (data.gallery ?? []);
  const gallery = gallerySource.length > 0 ? gallerySource : [media('product.placeholder')];
  const mainImage = gallery[activeImage] ?? gallery[0];
  const unitGallery360 = selectedUnit?.gallery360 ?? [];
  const gallery360 = unitGallery360.length > 0 ? unitGallery360 : data.gallery360;
  const has360 = gallery360.length > 0;
  const stockCount = flatUnits.length;
  // B5 T12b: model นี้เหลือ 0 หน่วยพร้อมขาย (ทุกเครื่องถูกขาย/ไม่ IN_STOCK แล้ว) —
  // permalink ยังเปิดได้ตามสเปก B4 (getProductDetail requireInStock:false บน head
  // query) แต่หน้าเว็บต้องไม่ทำ CTA ให้ดูเหมือนซื้อได้จริง — ดู copy.product.soldOutNotice
  const isSoldOut = stockCount === 0;
  const shareTargetId = selectedUnit?.id ?? data.id;
  const shareUrl = productShareUrl(shareTargetId);
  const imeiLast4 = selectedUnit?.imeiPartial?.slice(-4);
  const linePrefill = lineProductPrefill(displayName, imeiLast4, shareUrl);
  const messengerUrl = messengerRefUrl(shareTargetId, shopConfig?.facebookPageHandle);

  async function handleShare() {
    const shareData = { title: displayName, text: `${displayName} — BESTCHOICE ลพบุรี`, url: shareUrl };
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        // ผู้ใช้กดยกเลิกชีทแชร์ — ไม่ต้องทำอะไรต่อ
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success(copy.product.shareCopied);
    } catch {
      toast.error(copy.product.shareFailed);
    }
  }

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
              <Product360Viewer frames={gallery360} alt={displayName} />
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
                {price != null && price > 0 ? (
                  <div className="text-3xl md:text-4xl font-bold text-emerald-600 leading-snug">
                    ฿{price.toLocaleString()}
                  </div>
                ) : (
                  <div className="text-2xl md:text-3xl font-semibold text-muted-foreground leading-snug">
                    สอบถามราคาทางไลน์
                  </div>
                )}
                {stockCount > 0 ? (
                  <StockIndicator
                    display={
                      stockCount <= 3
                        ? `เหลือ ${stockCount} เครื่อง — ใกล้หมด`
                        : `เหลือ ${stockCount} เครื่อง`
                    }
                    tone={stockCount <= 3 ? 'urgent' : 'low'}
                  />
                ) : (
                  <StockIndicator display={copy.product.soldOutNotice} tone="out" />
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
              {isSoldOut ? (
                // B5 T12b: หมดสต็อก — ไม่มีเครื่องให้จอง/สมัครผ่อนแล้ว ปุ่มหลัก
                // ต้องพาไปทักแชทแทน (ไม่ใช่ปุ่มที่ดูเหมือนซื้อได้จริงแล้ว fail
                // แบบ reactive ตอนกด — ดู B5 task-12 QA report scenario I)
                <Button asChild variant="cta" size="lg" fullWidth>
                  <a
                    href={lineOaMessageUrl(linePrefill)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle className="size-4" aria-hidden="true" />
                    {copy.product.soldOutLineCta}
                  </a>
                </Button>
              ) : (
                <>
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
                </>
              )}
              <Button variant="ghost" size="lg" fullWidth onClick={handleShare}>
                <Share2 className="size-4" aria-hidden="true" />
                {copy.product.shareCta}
              </Button>
              <div className="flex flex-col gap-1.5">
                {/* หมดสต็อกแล้ว: ปุ่มไลน์หลักด้านบนคือ CTA เดียวกันนี้อยู่แล้ว —
                    ไม่ซ้ำลิงก์ปลายทางเดียวกันสองจุด (Messenger ยังโชว์ต่อ
                    เพราะเป็นช่องทางติดต่อคนละช่อง) */}
                {!isSoldOut && (
                  <a
                    href={lineOaMessageUrl(linePrefill)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 text-sm text-emerald-700 hover:underline underline-offset-4 leading-snug"
                  >
                    <MessageCircle className="size-4" aria-hidden="true" />
                    {copy.product.askLineCta}
                  </a>
                )}
                {messengerUrl && (
                  <a
                    href={messengerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 text-sm text-emerald-700 hover:underline underline-offset-4 leading-snug"
                  >
                    <MessageCircle className="size-4" aria-hidden="true" />
                    {copy.product.askMessengerCta}
                  </a>
                )}
              </div>
            </div>
          </Stack>
        </div>
      </Container>

      {/* B5 T12b: หมดสต็อกแล้วไม่มีเครื่องให้เลือกงวด/สมัครผ่อน — การ์ดนี้มีปุ่ม
         "สมัครผ่อนออนไลน์" ของตัวเองที่ยังชี้ไป /apply/<sold-product-id> อยู่
         (data.installmentPrice ของ head record อาจไม่ null แม้ 0 หน่วยพร้อมขาย)
         ต้องซ่อนทั้งการ์ดไปเลย ไม่ปล่อยให้โผล่บนหน้าเครื่องที่ขายแล้ว */}
      {!isSoldOut && (
        <Section padding="md">
          <Container>
            <InstallmentCalculatorCard
              productId={selectedUnit?.id ?? data.id}
              cashPrice={selectedUnit?.cashPrice ?? data.cashPrice}
              installmentPrice={selectedUnit?.installmentPrice ?? data.installmentPrice}
            />
          </Container>
        </Section>
      )}

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

      <RelatedSection productId={id!} />

      {/* Mobile sticky CTA — installment customers are the majority; give
         "สมัครผ่อน" equal billing with reserve instead of burying it above the fold.
         B5 T12b: หมดสต็อกแล้ว → ปุ่มเดียว พาไปทักแชทแทน (ดู desktop CTA ด้านบน) */}
      <StickyBottomBar>
        {isSoldOut ? (
          <Button asChild variant="cta" size="lg" fullWidth>
            <a href={lineOaMessageUrl(linePrefill)} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-4" aria-hidden="true" />
              {copy.product.soldOutLineCta}
            </a>
          </Button>
        ) : (
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
        )}
      </StickyBottomBar>
      <StickyBottomBarSpacer />
      <div className="md:hidden flex flex-col items-center gap-2 py-3">
        {!isSoldOut && (
          <a
            href={lineOaMessageUrl(linePrefill)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 text-sm text-emerald-700 hover:underline underline-offset-4 leading-snug"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            {copy.product.askLineCta}
          </a>
        )}
        {messengerUrl && (
          <a
            href={messengerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 text-sm text-emerald-700 hover:underline underline-offset-4 leading-snug"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            {copy.product.askMessengerCta}
          </a>
        )}
        <button
          type="button"
          onClick={handleShare}
          className="inline-flex items-center justify-center gap-1.5 min-h-11 px-4 text-sm text-emerald-700 hover:underline underline-offset-4 leading-snug"
        >
          <Share2 className="size-4" aria-hidden="true" />
          {copy.product.shareCta}
        </button>
      </div>
    </ShopLayout>
  );
}
