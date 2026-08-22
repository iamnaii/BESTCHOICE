/**
 * Catalog card derivations — the bits that turn a Product row into something a
 * shopper can compare at a glance.
 *
 * Owner rule (2026-08-21): **second-hand never groups**. Two used iPhone 15 Pro
 * Max 256GB are not the same thing — different grade, battery, colour, marks
 * and price — so each one is its own card. Only sealed new stock groups, where
 * one unit really is interchangeable with the next.
 */

/** Tags shown on a catalog card, in priority order. The card renders the first
 *  two; the reference storefront stacks five and buries the product photo. */
export function deriveUnitTags(
  p: {
    batteryHealth?: number | null;
    hasBox?: boolean | null;
    warrantyExpireDate?: Date | null;
    warrantyExpired?: boolean | null;
    stockInDate?: Date | null;
  },
  now: Date = new Date(),
): string[] {
  const tags: string[] = [];

  // Battery is the first thing anyone asks about a used iPhone.
  if (typeof p.batteryHealth === 'number' && p.batteryHealth >= 85) {
    tags.push(`แบต ${p.batteryHealth}%`);
  }

  if (p.warrantyExpireDate && p.warrantyExpired !== true) {
    const days = Math.floor((p.warrantyExpireDate.getTime() - now.getTime()) / 86_400_000);
    if (days > 90) tags.push(`ประกัน ${Math.floor(days / 30)} ด.`);
  }

  if (p.hasBox === true) tags.push('ครบกล่อง');

  if (p.stockInDate) {
    const days = Math.floor((now.getTime() - p.stockInDate.getTime()) / 86_400_000);
    if (days >= 0 && days <= 7) tags.push('เข้าใหม่');
  }

  return tags;
}

/**
 * The number a customer quotes in chat ("สนใจ #4218"). Taken from the last four
 * digits of the IMEI, which the detail page already surfaces as `imeiPartial`.
 *
 * Caveat: four digits are not unique across the whole stock, so two cards can
 * theoretically show the same label. It is a label only — every link and every
 * cart write uses the row's real uuid — but if collisions ever show up in the
 * grid the fix is a dedicated running-number column plus a backfill, not more
 * digits here.
 */
export function deriveDisplayNo(imeiSerial?: string | null): string | undefined {
  if (!imeiSerial) return undefined;
  const digits = imeiSerial.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

/**
 * Ordering key for "newest model first".
 *
 * Shoppers think in generations, not in when a device happened to reach the
 * shelf: every iPhone 15 Pro Max belongs together, and 16 comes before 15.
 * Rank is `generation * 10 + tier` so the whole catalogue sorts on one number.
 *
 * Tiers within a generation, high to low: Pro Max, Pro, Plus, base, e, mini.
 * Anything unparseable (SE, oddities, bad data) ranks 0 and lands at the end
 * rather than jumping the queue.
 */
export function modelRank(model: string): number {
  const m = /iphone\s*(\d+)/i.exec(model ?? '');
  if (!m) return 0;
  const gen = Number(m[1]);
  if (!Number.isFinite(gen)) return 0;

  const rest = model.slice(m.index + m[0].length).trim().toLowerCase();
  const tier = /^pro\s*max\b/.test(rest)
    ? 5
    : /^pro\b/.test(rest)
      ? 4
      : /^plus\b/.test(rest)
        ? 3
        : /^mini\b/.test(rest)
          ? 1
          : /^e\b/.test(rest)
            ? 2
            : rest === ''
              ? 2.5 // base model: below Plus, above the e/mini variants
              : 0;

  return gen * 10 + tier;
}

/** A before B before C; anything else (new stock, missing grade) sorts last. */
export function gradeRank(grade?: string | null): number {
  const i = ['A', 'B', 'C'].indexOf((grade ?? '').toUpperCase());
  return i < 0 ? 99 : i;
}
