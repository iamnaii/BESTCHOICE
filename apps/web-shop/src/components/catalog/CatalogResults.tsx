import { useRef } from 'react';
import { Search } from '@/lib/icons';
import { CARD_ROW_SUBGRID, ProductCard, type ProductGroup } from './ProductCard';
import { LoadingState } from '@/components/states/LoadingState';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { Button } from '@/components/ui/button';
import { gsap, useGSAP } from '@/components/motion/gsap';
import { copy } from '@/lib/copy';
import { cn } from '@/lib/utils';

interface Props {
  products: ProductGroup[] | undefined;
  total: number;
  loading: boolean;
  error: boolean;
  updating: boolean;
  resultKey: string;
  priceMode: 'cash' | 'installment';
  /** ลูกค้าติ๊ก "ฟรีดาวน์" — การ์ดแสดงเฉพาะกล่องฟรีดาวน์ */
  freeDownOnly?: boolean;
  /** สถานะ ②: เงินดาวน์ที่ใช้กับรายการนี้ (บาท) — null / ไม่ส่ง = ไม่ได้ใส่ */
  down?: number | null;
  /** สถานะ ②: จำนวนเครื่องที่ต้องดาวน์มากกว่าเงินที่ใส่ (API ตัดออกจากรายการแล้ว) */
  overBudgetCount?: number;
  /** เงินดาวน์น้อยสุดที่ทำให้เครื่องถัดไปขึ้น */
  nextDownFrom?: number | null;
  /** ยังมีหน้าถัดไปให้โหลด — บรรทัดท้ายรายการต้องอยู่ท้ายสุดจริง จึงไม่แสดงจนกว่าจะโหลดครบ */
  hasMore?: boolean;
  /** จำนวนเครื่องฟรีดาวน์ตามตัวกรองอื่น — มีจึงเสนอปุ่ม "ดูเครื่องฟรีดาวน์" ตอนเงินดาวน์ไม่พอ */
  freeDownCount?: number;
  onClearDown?: () => void;
  onShowFreeDown?: () => void;
  onRetry: () => void;
}

const GRID = 'grid grid-cols-2 lg:grid-cols-3 gap-2.5 md:gap-3';

export function CatalogResults({
  products,
  total,
  loading,
  error,
  updating,
  resultKey,
  priceMode,
  freeDownOnly = false,
  down = null,
  overBudgetCount = 0,
  nextDownFrom = null,
  hasMore = false,
  freeDownCount = 0,
  onClearDown,
  onShowFreeDown,
  onRetry,
}: Props) {
  const scope = useRef<HTMLDivElement>(null);
  const previous = useRef({ key: '', ids: new Set<string>() });
  const signature = products?.map((product) => product.id).join(',') ?? '';
  useGSAP(
    () => {
      if (loading || error || !scope.current) return;
      const cards = Array.from(scope.current.querySelectorAll<HTMLElement>('[data-product-card]'));
      const fresh = cards.filter(
        (card) =>
          previous.current.key !== resultKey ||
          !previous.current.ids.has(card.dataset.productCard!),
      );
      previous.current = {
        key: resultKey,
        ids: new Set(cards.map((card) => card.dataset.productCard!)),
      };
      if (!fresh.length || !window.matchMedia) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const animation = gsap.fromTo(
          fresh,
          { opacity: 0.3, y: 10 },
          {
            opacity: 1,
            y: 0,
            duration: 0.3,
            stagger: { each: 0.025, amount: Math.min(fresh.length * 0.025, 0.2) },
            ease: 'power2.out',
            clearProps: 'opacity,transform',
          },
        );
        const revealOnFocus = () => animation.progress(1);
        const node = scope.current;
        node?.addEventListener('focusin', revealOnFocus);
        return () => node?.removeEventListener('focusin', revealOnFocus);
      });
      return () => media.revert();
    },
    { scope, dependencies: [signature, resultKey, loading, error], revertOnUpdate: true },
  );

  return (
    <section aria-label="รายการสินค้า">
      <p
        role="status"
        aria-live="polite"
        className="mb-3 min-h-5 text-sm text-muted-foreground leading-snug"
      >
        {loading
          ? 'กำลังค้นหาสินค้าตามตัวเลือก…'
          : error
            ? 'โหลดรายการสินค้าไม่สำเร็จ'
            : updating
              ? 'กำลังอัปเดตรายการสินค้า…'
              : down != null
                ? copy.catalog.foundWithDown(total, down)
                : freeDownOnly
                  ? copy.catalog.foundFreeDown(total)
                  : `พบ ${total} รายการ`}
      </p>
      <div ref={scope} aria-busy={loading || updating}>
        {loading ? (
          <LoadingState gridClassName={GRID} />
        ) : error ? (
          <ErrorState onRetry={onRetry} />
        ) : !products?.length ? (
          down != null && overBudgetCount > 0 ? (
            // สถานะ ②: ไม่มีเครื่องที่ซื้อได้ด้วยเงินนี้ (มีเครื่องที่ถูกตัดเพราะเงิน — ไม่งั้นว่างเพราะตัวกรองอื่น) — บอกว่าต้องมีเท่าไร แล้วให้ทางไปต่อ
            <EmptyState
              icon={<Search className="size-12" />}
              title={copy.catalog.emptyDownTitle(down)}
              description={
                nextDownFrom != null ? copy.catalog.emptyDownDescription(nextDownFrom) : undefined
              }
            >
              {freeDownCount > 0 && (
                <Button type="button" variant="primary" size="md" onClick={onShowFreeDown}>
                  {copy.catalog.seeFreeDown}
                </Button>
              )}
              <Button type="button" variant="outline" size="md" onClick={onClearDown}>
                {copy.catalog.clearDown}
              </Button>
            </EmptyState>
          ) : (
            <EmptyState
              icon={<Search className="size-12" />}
              title={freeDownOnly ? copy.catalog.emptyFreeDownTitle : copy.catalog.emptyTitle}
              description={
                freeDownOnly
                  ? copy.catalog.emptyFreeDownDescription
                  : copy.catalog.emptyDescription
              }
            />
          )
        ) : (
          <>
            <div className={GRID}>
              {products.map((product) => (
                <div
                  key={product.id}
                  data-product-card={product.id}
                  className={cn('flex [&>article]:w-full', CARD_ROW_SUBGRID)}
                >
                  <ProductCard
                    product={product}
                    priceMode={priceMode}
                    freeDownOnly={freeDownOnly}
                    down={down}
                  />
                </div>
              ))}
            </div>
            {down != null && overBudgetCount > 0 && !hasMore && (
              <p
                data-over-budget
                className="mt-4 rounded-2xl bg-muted px-4 py-1 text-sm text-muted-foreground leading-snug"
              >
                {copy.catalog.overBudget(overBudgetCount, down, nextDownFrom)}{' '}
                <button
                  type="button"
                  onClick={onClearDown}
                  className="inline-flex min-h-11 items-center px-1 font-semibold text-primary underline underline-offset-4"
                >
                  {copy.catalog.showAll}
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
