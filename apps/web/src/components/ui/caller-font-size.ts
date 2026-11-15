// Input md is `text-base lg:text-sm` (16px below lg so iOS Safari does not zoom, S3-23).
// tailwind-merge only merges classes with the same variant prefix, so a bare caller size
// such as `text-2xl` replaces `text-base` but keeps `lg:text-sm`, and the variant's 14px
// would win at >= 1024px. When the caller sets its own size, drop the variant's
// responsive size so the caller's size holds at every width.

/** Bare theme sizes, including this app's `2xs`/`2sm`; optional `/line-height` and `!`. */
const THEME_SIZE = /^!?text-(?:2xs|xs|2sm|sm|base|lg|xl|[2-9]xl)(?:\/[^\s!]+)?!?$/;
/** `text-[13px]`, `text-[0.8125rem]`, `text-[length:…]`, `text-[clamp(…)]` — not colours. */
const ARBITRARY_SIZE =
  /^!?text-\[(?:length:[^\]]+|-?\d*\.?\d+(?:px|rem|em|%|vw|vh|vmin|vmax|svh|dvh|lvh|ch|ex|pt|pc|cm|mm|in|lh|rlh|cqw|cqh)|(?:calc|clamp|min|max)\([^\]]*\))\](?:\/[^\s!]+)?!?$/;

/** The variant classes this helper may drop. Only Input md carries one today. */
const RESPONSIVE_VARIANT_SIZES = new Set(['lg:text-sm']);

/** True when `className` has an unprefixed font-size utility (colour classes do not count). */
export function callerSetsFontSize(className?: string | null): boolean {
  if (!className) return false;
  return className
    .split(/\s+/)
    .some((token) => THEME_SIZE.test(token) || ARBITRARY_SIZE.test(token));
}

/**
 * `variantClasses` unchanged, or without its responsive font size when the caller
 * sets its own size. Use as `cn(withCallerFontSize(inputVariants({ variant }), className), className)`.
 */
export function withCallerFontSize(variantClasses: string, className?: string | null): string {
  if (!callerSetsFontSize(className)) return variantClasses;
  return variantClasses
    .split(/\s+/)
    .filter((token) => token && !RESPONSIVE_VARIANT_SIZES.has(token))
    .join(' ');
}
