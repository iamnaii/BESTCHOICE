import { useRef } from 'react';
import { Search } from 'lucide-react';
import { ProductCard, type ProductGroup } from './ProductCard';
import { LoadingState } from '@/components/states/LoadingState';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { gsap, useGSAP } from '@/components/motion/gsap';
import { copy } from '@/lib/copy';

interface Props {
  products: ProductGroup[] | undefined;
  total: number;
  loading: boolean;
  error: boolean;
  updating: boolean;
  resultKey: string;
  priceMode: 'cash' | 'installment';
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
              : `พบ ${total} รายการ`}
      </p>
      <div ref={scope} aria-busy={loading || updating}>
        {loading ? (
          <LoadingState gridClassName={GRID} />
        ) : error ? (
          <ErrorState onRetry={onRetry} />
        ) : !products?.length ? (
          <EmptyState
            icon={<Search className="size-12" />}
            title={copy.catalog.emptyTitle}
            description={copy.catalog.emptyDescription}
          />
        ) : (
          <div className={GRID}>
            {products.map((product) => (
              <div
                key={product.id}
                data-product-card={product.id}
                className="flex [&>article]:w-full"
              >
                <ProductCard product={product} priceMode={priceMode} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
