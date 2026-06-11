import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Gift, Percent, Tag, Sparkles, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import type { ShopPromotion } from '@/types/promotion';

export function usePromotions() {
  return useQuery<ShopPromotion[]>({
    queryKey: ['shop', 'promotions'],
    queryFn: () => api.get('/api/shop/promotions').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
}

export function promoBenefitLabel(p: ShopPromotion): string {
  switch (p.type) {
    case 'PERCENTAGE_DISCOUNT':
      return `ลด ${trimZeros(Number(p.discountValue ?? 0))}%`;
    case 'FIXED_DISCOUNT':
      return `ลดทันที ฿${Number(p.discountValue ?? 0).toLocaleString()}`;
    case 'FREE_ACCESSORY':
      return 'รับของแถมฟรี';
    case 'SPECIAL_RATE':
      return `ดอกเบี้ยพิเศษ ${trimZeros(Number(p.specialInterestRate ?? 0) * 100)}%`;
  }
}

export function promoIcon(p: ShopPromotion) {
  switch (p.type) {
    case 'PERCENTAGE_DISCOUNT':
      return <Percent className="size-5" aria-hidden="true" />;
    case 'FIXED_DISCOUNT':
      return <Tag className="size-5" aria-hidden="true" />;
    case 'FREE_ACCESSORY':
      return <Gift className="size-5" aria-hidden="true" />;
    case 'SPECIAL_RATE':
      return <Sparkles className="size-5" aria-hidden="true" />;
  }
}

export function promoEndsLabel(p: ShopPromotion): string {
  return `ถึง ${new Date(p.endDate).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

function trimZeros(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * Compact promotions banner for the home page. Renders nothing when there are
 * no active promotions — no empty section, no layout shift worth noting.
 */
export default function PromotionsStrip() {
  const { data } = usePromotions();
  if (!data || data.length === 0) return null;

  return (
    <section aria-label="โปรโมชัน" className="py-4">
      <div className="container mx-auto px-4">
        <div className="flex gap-3 overflow-x-auto pb-1 snap-x">
          {data.slice(0, 4).map((p) => (
            <Link
              key={p.id}
              to="/promotions"
              className="snap-start shrink-0 w-[280px] md:w-auto md:flex-1 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors px-4 py-3 leading-snug"
            >
              <span className="size-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0">
                {promoIcon(p)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-emerald-800 truncate">
                  {p.name}
                </span>
                <span className="block text-xs text-emerald-700">
                  {promoBenefitLabel(p)} · {promoEndsLabel(p)}
                </span>
              </span>
              <ChevronRight className="size-4 text-emerald-400 shrink-0" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
