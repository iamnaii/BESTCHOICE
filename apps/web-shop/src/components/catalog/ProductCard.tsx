import { useState } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { shopInfo } from '@/lib/copy';

export interface ProductGroup {
  /**
   * 'UNIT'  — one physical second-hand device. Grade, battery, colour and price
   *           all belong to THIS phone.
   * 'GROUP' — a model+storage of sealed new stock, where one unit really is
   *           interchangeable with the next.
   */
  kind: 'UNIT' | 'GROUP';
  /** Product id the card links to. For a UNIT this is that exact device. */
  id: string;
  /** Customer-facing device number ("#4218"). Units only. */
  displayNo?: string;
  brand: string;
  model: string;
  storage?: string;
  color?: string;
  minPrice: number | null;
  stockCount: number;
  thumbnailUrl?: string;
  /** Up to 5 photos. Absent on older API builds — always fall back to
   *  thumbnailUrl so a deploy-order skew degrades to a single-photo card. */
  images?: string[];
  monthlyPaymentFrom: number | null;
  /** The grade of this specific device. Units only. */
  conditionGrade?: string;
  conditionGrades?: string[];
  batteryHealth?: number;
  /** Derived badges from the API (battery / warranty / box / just-arrived). */
  tags?: string[];
  /** Down payment in baht for the down % the shopper picked. */
  downAmount?: number | null;
  /** Tenure the monthly figure is quoted at. */
  installmentMonths?: number | null;
  condition: 'NEW' | 'USED';
  stock: { display: string; tone: string };
}

interface Props {
  product: ProductGroup;
}

const GRADE_STYLES: Record<string, string> = {
  A: 'bg-emerald-500/80 text-white',
  B: 'bg-amber-500/85 text-white',
  C: 'bg-orange-500/85 text-white',
};
const GRADE_CHIP: Record<string, string> = {
  A: 'text-emerald-700',
  B: 'text-amber-900',
  C: 'text-orange-700',
};

/** Max thumbnails rendered before the strip collapses into a "+N" tile. */
const THUMB_SLOTS = 4;
/** The reference stacks up to five tags and buries the product photo. */
const MAX_TAGS = 2;

export function ProductCard({ product: p }: Props) {
  const to = p.id ? `/products/${p.id}` : '/products';
  const photos = (p.images?.length ? p.images : p.thumbnailUrl ? [p.thumbnailUrl] : []).slice(0, 5);
  const [active, setActive] = useState(0);
  const current = photos[Math.min(active, photos.length - 1)];

  const isNew = p.condition === 'NEW';
  const isUnit = p.kind === 'UNIT';
  const grade = p.conditionGrade ?? (!isNew ? p.conditionGrades?.[0] : undefined);
  const soldOut = p.stock.tone === 'out';

  // A used card carries the device's own facts; a new-stock card only has
  // "how many are left", so urgency is all it can honestly say.
  const tags: Array<{ label: string; warm?: boolean }> = isUnit
    ? (p.tags ?? []).slice(0, MAX_TAGS).map((label) => ({ label }))
    : p.stock.tone === 'urgent'
      ? [{ label: 'ใกล้หมด', warm: true }]
      : [];

  const hasQuote = p.monthlyPaymentFrom != null && p.monthlyPaymentFrom > 0;
  const visibleThumbs = photos.length > THUMB_SLOTS ? photos.slice(0, THUMB_SLOTS - 1) : photos;
  const overflow = photos.length - visibleThumbs.length;
  const specValue = [p.storage, isUnit ? p.color : isNew ? 'ของใหม่' : undefined]
    .filter(Boolean)
    .join(' · ');

  return (
    <article
      className={cn(
        'group flex flex-col rounded-[26px] md:rounded-[30px] border border-white bg-card/60 p-2 md:p-2.5',
        'shadow-lg backdrop-blur-sm transition-transform duration-200 ease-out',
        'hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none',
      )}
    >
      <Link to={to} className="block rounded-[20px] md:rounded-3xl">
        <div
          className={cn(
            'relative aspect-[4/3] rounded-[20px] md:rounded-3xl bg-muted overflow-hidden flex items-center justify-center',
            soldOut && 'opacity-60',
          )}
        >
          {current ? (
            <img
              src={current}
              alt={`${p.brand} ${p.model}`}
              className="max-h-[80%] max-w-[80%] object-contain"
              loading="lazy"
            />
          ) : (
            <div className="text-muted-foreground text-xs">ไม่มีรูป</div>
          )}

          {/* New stock gets a plain pill; only a graded second-hand device earns
              the letter chip, so the chip always means "this is the grade".
              Below sm the two-column grid leaves ~168px of card, so the word
              GRADE drops and the coloured letter carries it alone. */}
          <span
            className={cn(
              'absolute top-1.5 left-1.5 md:top-2 md:left-2 inline-flex items-center gap-1.5 rounded-full backdrop-blur-md ring-1 ring-inset ring-white/55 max-w-[70%]',
              isNew
                ? 'bg-emerald-500/85 text-white px-2 py-1 md:px-2.5'
                : cn('p-0.5 sm:pr-2', GRADE_STYLES[grade ?? ''] ?? 'bg-zinc-700/75 text-white'),
            )}
            aria-label={
              isNew ? 'เครื่องมือ 1 ของใหม่' : grade ? `สภาพเครื่องเกรด ${grade}` : 'เครื่องมือสอง'
            }
          >
            {!isNew && (
              <span
                className={cn(
                  'size-[18px] md:size-5 rounded-full bg-white grid place-items-center font-brand text-[10px] md:text-[11px] font-extrabold leading-none shrink-0',
                  GRADE_CHIP[grade ?? ''] ?? 'text-zinc-700',
                )}
                aria-hidden
              >
                {grade ?? '·'}
              </span>
            )}
            <span
              className={cn(
                'font-brand text-[8.5px] md:text-[9.5px] font-extrabold uppercase tracking-[0.09em] leading-none whitespace-nowrap',
                isNew ? '' : 'hidden sm:inline',
              )}
              aria-hidden
            >
              {isNew ? (
                <>
                  มือ 1<span className="hidden md:inline"> · ของใหม่</span>
                </>
              ) : grade ? (
                `GRADE ${grade}`
              ) : (
                'มือ 2'
              )}
            </span>
          </span>

          {tags.length > 0 && (
            <div className="absolute top-1.5 right-1.5 md:top-2 md:right-2 flex flex-col items-end gap-1 max-w-[52%]">
              {tags.map((t) => (
                <span
                  key={t.label}
                  className="inline-flex items-center gap-1.5 rounded-full bg-card/70 px-2 py-0.5 text-[9px] md:text-[10px] text-foreground ring-1 ring-inset ring-white/90 backdrop-blur-sm leading-snug whitespace-nowrap"
                >
                  <span
                    className={cn(
                      'size-1.5 rounded-full shrink-0',
                      t.warm ? 'bg-orange-500' : 'bg-emerald-500',
                    )}
                    aria-hidden
                  />
                  {t.label}
                </span>
              ))}
            </div>
          )}

          {photos.length > 1 && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1" aria-hidden>
              {photos.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1 rounded-full transition-all',
                    i === active ? 'w-3 bg-foreground/55' : 'w-1 bg-foreground/20',
                  )}
                />
              ))}
            </div>
          )}
        </div>
      </Link>

      {/* Thumbnail strip — real photos of this device. Hidden when there is only
          one photo so the card never shows a fake filmstrip. */}
      {photos.length > 1 && (
        <div className="hidden sm:flex gap-1.5 mt-2">
          {visibleThumbs.map((src, i) => (
            <button
              key={src + i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`ดูรูปที่ ${i + 1}`}
              aria-pressed={i === active}
              className={cn(
                'flex-1 aspect-square rounded-xl bg-muted overflow-hidden flex items-center justify-center transition-shadow',
                i === active
                  ? 'ring-2 ring-emerald-500'
                  : 'ring-1 ring-inset ring-border hover:ring-emerald-300',
              )}
            >
              <img
                src={src}
                alt=""
                className="max-h-[78%] max-w-[78%] object-contain"
                loading="lazy"
              />
            </button>
          ))}
          {overflow > 0 && (
            <Link
              to={to}
              aria-label={`ดูรูปทั้งหมด ${photos.length} รูป`}
              className="flex-1 aspect-square rounded-xl bg-zinc-200 grid place-items-center text-[11px] font-bold text-muted-foreground hover:bg-zinc-300 transition-colors"
            >
              +{overflow}
            </Link>
          )}
        </div>
      )}

      <div className="flex flex-col flex-1 px-1 pt-2.5">
        <Link to={to} className="block">
          <div className="flex items-baseline justify-between gap-2 min-h-[38px]">
            <h3 className="font-display text-[14px] md:text-[15px] font-bold text-foreground leading-snug">
              {p.model}
            </h3>
            {/* The device number is what a customer quotes in chat ("สนใจ #4218").
                New stock has no single device to point at, so it shows depth. */}
            {isUnit ? (
              p.displayNo && (
                <span className="num text-[11px] md:text-xs font-bold text-muted-foreground shrink-0">
                  #{p.displayNo}
                </span>
              )
            ) : (
              <span className="num text-[11px] md:text-xs font-semibold text-muted-foreground shrink-0">
                {p.stockCount} เครื่อง
              </span>
            )}
          </div>

          <div className="flex justify-between gap-2 mt-1 text-[11px] md:text-xs text-muted-foreground leading-snug">
            <span className="shrink-0">ความจุ</span>
            <span className="text-right truncate">{specValue || '—'}</span>
          </div>

          {/* Installment figure sits where the reference puts its view count:
              it is the differentiator, and the full price stays the biggest
              number on the card. */}
          <div className="mt-2">
            {p.minPrice == null ? (
              <span className="text-sm font-medium text-muted-foreground">สอบถามราคา</span>
            ) : (
              <>
                <div className="flex items-end justify-between gap-1.5">
                  <span className="num text-[10.5px] md:text-[11.5px] font-semibold text-emerald-700 whitespace-nowrap">
                    {hasQuote ? `ผ่อน ฿${p.monthlyPaymentFrom!.toLocaleString()}/ด.` : 'ผ่อนได้'}
                  </span>
                  <span className="num text-[17px] md:text-lg font-bold text-foreground whitespace-nowrap">
                    ฿{p.minPrice.toLocaleString()}
                  </span>
                </div>
                {/* A monthly figure with no down payment and no tenure beside it
                    is a half-truth — always print what it was quoted on. */}
                {hasQuote && p.downAmount != null && (
                  <p className="num mt-0.5 text-[9.5px] md:text-[10.5px] text-muted-foreground leading-snug">
                    ดาวน์ ฿{p.downAmount.toLocaleString()}
                    {p.installmentMonths ? ` · ${p.installmentMonths} งวด` : ''}
                  </p>
                )}
              </>
            )}
          </div>
        </Link>

        <div className="mt-2.5">
          {soldOut ? (
            <a
              href={shopInfo.lineUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-9 items-center justify-center rounded-full border border-border text-[12.5px] font-medium text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors leading-snug"
            >
              ทักแชทเช็ครอบเข้าใหม่
            </a>
          ) : (
            <Link
              to={to}
              className="flex h-9 items-center justify-center rounded-full bg-ink text-ink-foreground text-[12.5px] font-semibold hover:bg-zinc-800 transition-colors leading-snug"
            >
              {isUnit ? 'ดูเครื่องนี้' : 'เลือกเครื่อง'}
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
