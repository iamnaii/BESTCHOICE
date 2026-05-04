import { Link } from 'react-router';
import { cn } from '@/lib/utils';

export interface ProductGroup {
  brand: string;
  model: string;
  minPrice: number;
  stockCount: number;
  thumbnailUrl?: string;
  monthlyPaymentFrom: number;
  conditionGrades?: string[];
  stock: { display: string; tone: string };
}

interface Props {
  product: ProductGroup;
}

function gradeChip(g: string) {
  return (
    <span
      key={g}
      aria-label={`เกรด ${g}`}
      className="size-6 rounded-full bg-background/85 backdrop-blur-md border border-foreground/10 text-foreground text-[11px] font-semibold flex items-center justify-center leading-none"
    >
      {g}
    </span>
  );
}

export function ProductCard({ product: p }: Props) {
  const to = `/products?brand=${encodeURIComponent(p.brand)}&model=${encodeURIComponent(p.model)}`;
  const grades = p.conditionGrades ?? [];

  return (
    <article className="group text-center">
      <Link to={to} className="block">
        {/* Image plate — light surface, generous space, gentle hover scale.
           Smaller radius on mobile (rounded-2xl) so dense 2-col grids breathe. */}
        <div className="relative aspect-square bg-zinc-100 rounded-2xl md:rounded-3xl overflow-hidden flex items-center justify-center mb-3 md:mb-4">
          {p.thumbnailUrl ? (
            <img
              src={p.thumbnailUrl}
              alt={`${p.brand} ${p.model}`}
              className="max-h-[78%] max-w-[78%] object-contain transition-transform duration-500 ease-out group-hover:scale-[1.04]"
              loading="lazy"
            />
          ) : (
            <div className="text-zinc-400 text-xs md:text-sm">ไม่มีรูป</div>
          )}
          {grades.length > 0 && (
            <div className="absolute top-2 left-2 md:top-3 md:left-3 flex gap-1">
              {grades.map(gradeChip)}
            </div>
          )}
        </div>

        {/* Caption block — Apple-style centered text. Tighter on mobile. */}
        <div className="leading-snug space-y-0.5 md:space-y-1">
          <p className="text-[10px] md:text-[11px] uppercase tracking-[0.14em] md:tracking-[0.16em] text-muted-foreground">
            {p.brand}
          </p>
          <h3 className="font-display text-base md:text-xl lg:text-2xl font-semibold text-foreground tracking-tight line-clamp-1">
            {p.model}
          </h3>
          <p className="num text-lg md:text-2xl font-semibold text-foreground pt-1 md:pt-2">
            ฿{p.minPrice.toLocaleString()}
          </p>
          <p className="text-[11px] md:text-[13px] text-muted-foreground">
            หรือ <span className="num">฿{p.monthlyPaymentFrom.toLocaleString()}</span>/ด.
          </p>
        </div>
      </Link>

      {/* Stock chip — visible on every breakpoint */}
      <div className="flex flex-col items-center gap-2 md:gap-3 mt-2 md:mt-4">
        <span
          className={cn(
            'inline-flex items-center gap-1 md:gap-1.5 text-[10px] md:text-[12px] px-2 md:px-2.5 py-0.5 md:py-1 rounded-full',
            p.stock.tone === 'urgent'
              ? 'text-amber-700 bg-amber-100/80'
              : p.stock.tone === 'out'
                ? 'text-muted-foreground bg-muted'
                : 'text-emerald-700 bg-emerald-50',
          )}
        >
          <span
            className={cn(
              'size-1 md:size-1.5 rounded-full',
              p.stock.tone === 'urgent' ? 'bg-amber-500' : p.stock.tone === 'out' ? 'bg-muted-foreground' : 'bg-emerald-500',
            )}
          />
          {p.stock.display}
        </span>
        {/* CTA button hidden on mobile — whole card is linkable.
           Shown on md+ where grid is sparser and the action affordance helps.
           aria-hidden + tabIndex=-1 because the parent block link already
           handles navigation; this is a visual-only secondary cue. */}
        <Link
          to={to}
          aria-hidden="true"
          tabIndex={-1}
          className="hidden md:inline-flex h-10 px-6 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 active:bg-primary/80 transition-colors items-center justify-center"
        >
          เลือกเครื่อง
        </Link>
      </div>
    </article>
  );
}
