import { useState } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { shopInfo } from '@/lib/copy';
import { deviceOriginLabel, type DeviceOrigin } from '@/lib/device-origin';
import { DEFAULT_DETAIL_MONTHS, MAX_DETAIL_MONTHS } from '@/lib/installment-defaults';
import { PlanTiles, showsRate2Tile } from './PlanTiles';
import { useGallerySwipe } from './useGallerySwipe';
import { formatNumber } from '@/lib/format';

export interface ProductGroup {
  deviceOrigin?: DeviceOrigin | null;
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
  /** แผนเรท 2 ที่ค่าตั้งต้นของเครื่อง (ดาวน์ 0 = ฟรีดาวน์). ไม่มีใน API รุ่นเก่า. */
  rate2?: { down: number; monthly: number; months: number } | null;
  condition: 'NEW' | 'USED';
  stock: { display: string; tone: string };
}

interface Props {
  product: ProductGroup;
  /** ลูกค้าติ๊ก "ฟรีดาวน์" ในตัวกรอง — การ์ดแสดงเฉพาะกล่องฟรีดาวน์ */
  freeDownOnly?: boolean;
  /** สถานะ ②: เงินดาวน์ที่ลูกค้าพิมพ์ในหน้ารวม (บาท) — ลิงก์ของการ์ดพาไปหน้ารายละเอียดด้วย */
  down?: number | null;
  /**
   * 'combined' (default) is the original dual layout — cash price big with
   * the installment teaser under it (HomePage / related sections).
   * The catalog's สด/ผ่อน switch passes the strict modes instead, and they
   * hide the other price entirely (owner decision 2026-08-31):
   * 'installment' = yellow down-payment badge + monthly figure, no cash
   * price at all; 'cash' = full price only, no installment rate at all.
   */
  priceMode?: 'combined' | 'cash' | 'installment';
  /**
   * การ์ดแถวแรกที่ลูกค้าเห็นทันทีโดยไม่ต้องเลื่อน (หน้ารายการสินค้า 4 ใบแรก) —
   * โหลดรูปทันทีและบอกเบราว์เซอร์ว่าสำคัญ · การ์ดอื่นรอจนเลื่อนใกล้ถึง (`loading="lazy"`)
   */
  priority?: boolean;
}

/**
 * ป้ายสถานะ (เจ้าของ 2026-11-27 ส่วน A3): มือ 1 = พื้นเขียวตัวขาว · มือ 2 = ขอบกรมท่าพื้นขาว.
 * ใช้เขียวเข้ม #0B7F5A ไม่ใช่เขียวโลโก้ #1DA479 — ตัวขาวบนเขียวโลโก้ได้แค่ 3.2:1 (ต้อง 4.5:1).
 * เกรดของมือสองเป็นวงกลมตัวอักษรกรมท่าในป้ายเดียวกัน (ไม่ใช้เหลือง/ส้ม/แดง — เกรด = ข้อมูล
 * ไม่ใช่คำเตือน คำตัดสินเจ้าของ 2026-08-31)
 */
const NEW_CHIP = 'bg-brand-green-dark text-white ring-transparent';
const USED_CHIP = 'bg-white text-primary ring-primary';
const GRADE_DISC = 'bg-primary text-white';

/** ป้ายข้อมูลใต้ชื่อรุ่น — เกินสองใบแถวป้ายจะยาวกว่าราคา */
const MAX_TAGS = 2;
/** ป้ายข้อมูลทั่วไป (ไทย/นอก · ประกัน) — เทากลาง */
const CHIP_BASE =
  'inline-flex items-center gap-1 rounded-full px-1.5 sm:px-2 py-0.5 text-xs leading-snug max-w-full whitespace-nowrap';
const INFO_CHIP = `${CHIP_BASE} bg-zinc-100 text-zinc-700`;

/**
 * สีของป้ายจากข้อความ (ป้ายมาจาก API เป็นข้อความ — `catalog-item.util.ts`):
 * แบต 90% ขึ้นไป = พื้น mint-tint ตัวเขียวเข้ม (4.7:1) · เข้าใหม่ = พื้นเขียวอ่อนมีเส้นเขียว ·
 * ใกล้หมด = พื้นส้มอ่อนตัวส้มเข้ม (5.5:1) · อื่น ๆ เทา
 */
function tagChipClass(label: string, warm?: boolean): string {
  if (warm) return `${CHIP_BASE} bg-orange-100 text-orange-700`;
  if (label === 'เข้าใหม่')
    return `${CHIP_BASE} bg-mint-tint text-brand-green-dark ring-1 ring-inset ring-brand-green`;
  const battery = /^แบต (\d+)%$/.exec(label);
  if (battery && Number(battery[1]) >= 90) return `${CHIP_BASE} bg-mint-tint text-brand-green-dark`;
  return INFO_CHIP;
}

/**
 * การ์ดยืม 3 แถวของกริดแม่ (รูป · ข้อมูล · แถบราคา) ด้วย subgrid ⇒ แถบราคาทุกใบในแถวเดียวกันเริ่มระดับเดียวกัน
 * แม้ชื่อรุ่นหรือป้ายของบางใบตกบรรทัด · ผู้วางการ์ดที่ห่อการ์ดด้วย element อื่น (CatalogResults) ต้องใส่คลาสนี้ที่ตัวห่อด้วย
 * · การ์ดต้องมีลูกตรง 3 ตัวพอดี · เบราว์เซอร์ที่ไม่รู้จัก subgrid ได้การ์ด flex เดิม (แถบอาจไม่ตรงกัน แต่ไม่เพี้ยน)
 */
export const CARD_ROW_SUBGRID =
  'supports-[grid-template-rows:subgrid]:row-span-3 supports-[grid-template-rows:subgrid]:grid supports-[grid-template-rows:subgrid]:grid-rows-subgrid supports-[grid-template-rows:subgrid]:gap-y-0';

export function ProductCard({
  product: p,
  priceMode = 'combined',
  freeDownOnly = false,
  down = null,
  priority = false,
}: Props) {
  const hasQuote = p.monthlyPaymentFrom != null && p.monthlyPaymentFrom > 0;
  // เงินดาวน์ที่พิมพ์ไว้ + งวดที่การ์ดโชว์เรท 1 ตามไปหน้ารายละเอียด (คำตัดสิน ข1) ·
  // งวดเท่าค่าตั้งต้นของหน้านั้นไม่ต้องส่ง · การ์ดที่ไม่โชว์กล่องเรท 1 ก็ไม่ส่งงวด ·
  // งวดเกินเพดานที่หน้ารายละเอียดคิดได้ก็ไม่ส่ง (หน้านั้นเปิดที่ค่าตั้งต้นตามเดิม)
  const shownMonths =
    priceMode === 'installment' &&
    !freeDownOnly &&
    hasQuote &&
    p.downAmount != null &&
    typeof p.installmentMonths === 'number' &&
    Number.isInteger(p.installmentMonths) &&
    p.installmentMonths >= 1 &&
    p.installmentMonths <= MAX_DETAIL_MONTHS &&
    p.installmentMonths !== DEFAULT_DETAIL_MONTHS
      ? p.installmentMonths
      : null;
  const query = new URLSearchParams();
  if (down) query.set('down', String(down));
  if (shownMonths != null) query.set('months', String(shownMonths));
  const qs = query.toString();
  const to = p.id ? `/products/${p.id}${qs ? `?${qs}` : ''}` : '/products';
  const photos = (p.images?.length ? p.images : p.thumbnailUrl ? [p.thumbnailUrl] : []).slice(0, 5);
  const [active, setActive] = useState(0);
  const shown = Math.min(active, Math.max(photos.length - 1, 0));
  const current = photos[shown];
  const many = photos.length > 1;
  // รูปเต็มขอบการ์ด ไม่มีแถบรูปย่อ — เลื่อนดูมุมอื่นด้วยการปัดรูป (มือถือ) หรือลูกศรตอนชี้ (เมาส์)
  const step = (direction: number) =>
    setActive((shown + direction + photos.length) % photos.length);
  const swipe = useGallerySwipe(step, many);

  const rate1Plan =
    hasQuote && p.downAmount != null
      ? { down: p.downAmount, monthly: p.monthlyPaymentFrom!, months: p.installmentMonths ?? null }
      : null;
  // สองราคาบนการ์ด = กล่องเรท 1 กับกล่องเรท 2 ขึ้นพร้อมกัน (กติกาเดียวกับ PlanTiles)
  const twoRates =
    priceMode === 'installment' &&
    p.minPrice != null &&
    !freeDownOnly &&
    rate1Plan != null &&
    showsRate2Tile(rate1Plan, p.rate2 ?? null);

  const isNew = p.condition === 'NEW';
  const isUnit = p.kind === 'UNIT';
  const rawGrade = p.conditionGrade ?? (!isNew ? p.conditionGrades?.[0] : undefined);
  const grade = rawGrade && ['A', 'B', 'C', 'D'].includes(rawGrade) ? rawGrade : undefined;
  const soldOut = p.stock.tone === 'out';

  // A used card carries the device's own facts; a new-stock card only has
  // "how many are left", so urgency is all it can honestly say.
  const tags: Array<{ label: string; warm?: boolean }> = isUnit
    ? (p.tags ?? []).slice(0, MAX_TAGS).map((label) => ({ label }))
    : p.stock.tone === 'urgent'
      ? [{ label: 'ใกล้หมด', warm: true }]
      : [];

  const specValue = [p.storage, isUnit ? p.color : isNew ? 'ของใหม่' : undefined]
    .filter(Boolean)
    .join(' · ');

  // New stock gets a plain chip; only a graded second-hand device earns the
  // letter, so the letter always means "this is the grade". Below sm the
  // two-column grid leaves ~160px of card, so the word GRADE drops and the
  // coloured letter carries it alone.
  const conditionChip = (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full ring-1 ring-inset text-xs leading-snug whitespace-nowrap',
        isNew
          ? cn(NEW_CHIP, 'px-1.5 py-0.5 sm:px-2')
          : cn(grade ? 'p-0.5 sm:pr-2' : 'px-1.5 py-0.5 sm:px-2', USED_CHIP),
      )}
      aria-label={
        isNew ? 'เครื่องมือ 1 ของใหม่' : grade ? `สภาพเครื่องเกรด ${grade}` : 'เครื่องมือสอง'
      }
    >
      {!isNew && grade && (
        <span
          className={cn(
            'size-4 rounded-full grid place-items-center font-brand text-[10px] font-bold leading-snug shrink-0',
            GRADE_DISC,
          )}
          aria-hidden
        >
          {grade}
        </span>
      )}
      <span
        className={cn(
          'font-brand font-bold uppercase',
          isNew || !grade ? '' : 'hidden sm:inline',
        )}
        aria-hidden
      >
        {isNew ? 'มือ 1' : grade ? `GRADE ${grade}` : 'มือ 2'}
      </span>
    </span>
  );

  return (
    <article
      className={cn(
        'group flex flex-col overflow-hidden rounded-2xl md:rounded-3xl border border-border bg-card',
        CARD_ROW_SUBGRID,
        'shadow-sm transition-[transform,box-shadow,border-color] duration-200 ease-out',
        // ชี้ / แตะ / โฟกัสด้วยคีย์บอร์ด: ขอบเขียวโลโก้ + เงาเข้มขึ้นเล็กน้อย (ส่วน A3)
        'hover:-translate-y-0.5 hover:shadow-lg hover:border-brand-green',
        'active:border-brand-green focus-within:border-brand-green',
        'motion-reduce:transform-none motion-reduce:transition-none',
      )}
    >
      {/* รูปเต็มขอบการ์ด (เจ้าของ 2026-11-26) ไม่มีกรอบสีซ้อน · ใช้ object-contain ไม่ใช่ cover:
          รูปจัตุรัส (รูปจากแอปแม่แบบของร้าน) เต็มกรอบเท่ากันทุกอย่าง แต่ระบบไม่ได้บังคับให้รูปเป็นจัตุรัส
          (หน้าอัปโหลด/รับของย่อรูปโดยคงสัดส่วน) — รูปแนวตั้ง/แนวนอนจึงต้องแสดงครบ ห้ามตัดหัวท้ายเครื่อง
          · รูปมือสองมีป้ายมุมถ่าย ("ด้านหน้า") ฝังมาในไฟล์ — การ์ดจึงไม่วางป้ายทับรูปมือสอง ·
          มือ 1 ได้ป้าย "เครื่องใหม่" มุมซ้ายบน แยกจากมือสองได้ทันที (ส่วน B1) */}
      <div className="relative touch-pan-y select-none" {...swipe}>
        <Link to={to} className="block">
          <div
            className={cn(
              'relative aspect-square overflow-hidden bg-zinc-100',
              soldOut && 'opacity-60',
            )}
          >
            {current ? (
              <img
                src={current}
                alt={`${p.brand} ${p.model}`}
                className="size-full object-contain"
                loading={priority ? 'eager' : 'lazy'}
                fetchPriority={priority ? 'high' : 'auto'}
                draggable={false}
              />
            ) : (
              <div className="grid size-full place-items-center text-xs text-muted-foreground">
                ไม่มีรูป
              </div>
            )}

            {isNew && (
              <span className="absolute left-2 top-2 rounded-full bg-brand-green-dark px-2 py-0.5 font-head text-xs font-bold leading-snug text-white shadow-sm">
                เครื่องใหม่
              </span>
            )}

            {many && (
              <div
                className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 rounded-full bg-white/75 px-1.5 py-1 shadow-sm"
                aria-hidden
              >
                {photos.map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'h-1 rounded-full transition-[width,background-color] motion-reduce:transition-none',
                      i === shown ? 'w-3 bg-foreground/70' : 'w-1 bg-foreground/25',
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        </Link>

        {/* ลูกศรอยู่นอก <a> (ปุ่มซ้อนในลิงก์ไม่ได้) · โผล่เฉพาะอุปกรณ์ที่ชี้ได้ — บนจอสัมผัส
            group-hover ไม่ทำงาน ปุ่มจึงทั้งมองไม่เห็นและกดไม่โดน (pointer-events-none) */}
        {many &&
          ([-1, 1] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              data-gallery-control
              onClick={() => step(direction)}
              aria-label={direction < 0 ? 'รูปก่อนหน้า' : 'รูปถัดไป'}
              className={cn(
                'absolute top-1/2 -translate-y-1/2 grid size-8 place-items-center rounded-full bg-white/90 text-foreground shadow-md',
                'opacity-0 pointer-events-none transition-opacity motion-reduce:transition-none',
                'group-hover:opacity-100 group-hover:pointer-events-auto',
                'focus-visible:opacity-100 focus-visible:pointer-events-auto focus-visible:outline-2 focus-visible:outline-primary',
                'hover:bg-white',
                direction < 0 ? 'left-2' : 'right-2',
              )}
            >
              {direction < 0 ? (
                <ChevronLeft className="size-4" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-4" aria-hidden="true" />
              )}
            </button>
          ))}
      </div>

      <Link to={to} className="block px-2.5 pt-2.5 sm:px-3.5 sm:pt-3">
        <h3 className="font-display text-base font-bold text-foreground leading-snug">
          {p.model}
        </h3>

        {/* Spec as one quiet line; the device number shares it so the title keeps
            the full card width (a two-column phone grid leaves ~130px). */}
        <div className="mt-0.5 flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-xs text-muted-foreground leading-snug">
            {specValue || '—'}
          </span>
          {/* The device number is what a customer quotes in chat ("สนใจ #4218").
              New stock has no single device to point at, so it shows depth. */}
          {isUnit ? (
            p.displayNo && (
              <span className="num text-xs font-bold text-muted-foreground shrink-0">
                #{p.displayNo}
              </span>
            )
          ) : (
            <span className="num text-xs font-semibold text-muted-foreground shrink-0">
              {p.stockCount} เครื่อง
            </span>
          )}
        </div>

        {/* ป้ายข้อมูลอยู่ใต้ชื่อรุ่น ไม่ทับรูป (เจ้าของ 2026-11-26 "ทำรูปให้เต็ม") — ป้ายสภาพเครื่องนำหน้า
            · จุดส้มสงวนให้ "ใกล้หมด" ที่เป็นสัญญาณเร่งจริง และมีคำกำกับเสมอ */}
        <div className="mt-2 flex flex-wrap gap-1">
          {conditionChip}
          <span className={INFO_CHIP}>{deviceOriginLabel(p.deviceOrigin)}</span>
          {tags.map((t) => (
            <span key={t.label} className={tagChipClass(t.label, t.warm)}>
              {t.warm && (
                <span className="size-1.5 rounded-full shrink-0 bg-orange-500" aria-hidden />
              )}
              <span className="truncate" title={t.label}>
                {t.label}
              </span>
            </span>
          ))}
        </div>
      </Link>

      {/* แถบราคา: พื้นเทาอ่อนแถบเดียวต่อการ์ด เต็มความกว้าง ยาวลงถึงปุ่ม — แยกส่วนราคาออกจากส่วนข้อมูล
          โดยไม่ใช้พื้นสี (พื้นมิ้นต์ทั้งแบบกล่องซ้อนและแบบแถบเดียวโดนว่าเลี่ยนทั้งคู่) */}
      <div className="mt-2.5 flex flex-1 flex-col border-t border-zinc-100 bg-zinc-50 px-2.5 pt-2.5 pb-2.5 sm:px-3.5 sm:pt-3 sm:pb-3.5">
        {/* Price zone — one left-aligned block in every mode: a small
            eyebrow names the number, the figure sits under it, details on a
            third line. No lone right-aligned figures, no zigzag. */}
        <Link to={to} className="block">
          {p.minPrice == null ? (
            <span className="text-sm font-medium text-muted-foreground">สอบถามราคา</span>
          ) : priceMode === 'installment' ? (
            <PlanTiles rate1={rate1Plan} rate2={p.rate2 ?? null} freeDownOnly={freeDownOnly} />
          ) : priceMode === 'cash' ? (
            <>
              <div className="font-head text-xs font-medium text-muted-foreground leading-snug">
                ราคาเงินสด
              </div>
              <div className="num text-xl md:text-2xl font-bold text-primary leading-tight whitespace-nowrap">
                ฿{formatNumber(p.minPrice)}
              </div>
            </>
          ) : (
            <>
              <div className="num text-xl md:text-2xl font-bold text-primary leading-tight whitespace-nowrap">
                ฿{formatNumber(p.minPrice)}
              </div>
              {/* A monthly figure with no down payment beside it is a
                  half-truth — always print what it was quoted on. */}
              <p className="num mt-0.5 text-xs text-muted-foreground leading-snug">
                {hasQuote ? `ผ่อน ฿${formatNumber(p.monthlyPaymentFrom!)}/ด.` : 'ผ่อนได้'}
                {hasQuote && p.downAmount != null
                  ? ` · ดาวน์ ฿${formatNumber(p.downAmount)}`
                  : ''}
              </p>
            </>
          )}
        </Link>

        {/* การ์ดที่โชว์สองราคามีชื่อกำกับ "เรท 1 / เรท 2" แล้ว — ลิงก์อธิบายอยู่นอก <Link> ของการ์ด
            (ลิงก์ซ้อนลิงก์ไม่ได้) ไปหัวข้อเรทในหน้าวิธีผ่อน (ส่วน B2) */}
        {twoRates && (
          <Link
            to="/how-it-works#rates"
            className="mt-1.5 inline-block self-start font-head text-xs font-medium leading-snug text-brand-green-dark underline underline-offset-2 hover:no-underline"
          >
            เรทต่างกันอย่างไร
          </Link>
        )}

        <div className="mt-auto pt-3">
          {soldOut ? (
            <a
              href={shopInfo.lineUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center justify-center px-2 py-2 text-center rounded-full bg-line-app text-white font-head text-sm font-semibold hover:bg-line-app/90 transition-colors leading-snug"
            >
              ทักแชทเช็ครอบเข้าใหม่
            </a>
          ) : (
            <Link
              to={to}
              className="flex min-h-11 items-center justify-center px-2 py-2 text-center rounded-full bg-brand-green-dark text-white font-head text-sm font-semibold hover:brightness-[0.92] active:brightness-[0.85] leading-snug"
            >
              {isUnit ? 'ดูเครื่องนี้' : 'เลือกเครื่อง'}
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
