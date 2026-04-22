/**
 * Central photo/illustration URL map. Swap entries here to upgrade
 * from placeholders to real photography — no component change needed.
 *
 * All /media/*.jpg assets are committed under apps/web-shop/public/media/
 * (small AI-abstract + Unsplash placeholders). Apple press photos link
 * out to apple.com's CDN (license: authorized reseller use).
 */

export const mediaPlaceholders = {
  // Hero + branding
  'hero.home': '/media/hero-home.jpg',
  'hero.catalog': '/media/hero-catalog.jpg',
  'hero.apply': '/media/hero-apply.jpg',
  'hero.trade-in': '/media/hero-trade-in.jpg',
  'hero.buyback': '/media/hero-buyback.jpg',
  'hero.saving': '/media/hero-saving.jpg',
  'og.default': '/media/og-default.jpg',

  // Staff + shop
  'staff.owner': '/media/staff-owner.jpg',
  'staff.team': '/media/staff-team.jpg',
  'shop.interior': '/media/shop-interior.jpg',
  'shop.map': '/media/shop-map.jpg',

  // Product placeholders (fallbacks when DB.gallery is empty)
  'product.placeholder': '/media/product-placeholder.jpg',
} as const;

export type MediaKey = keyof typeof mediaPlaceholders;
export function media(key: MediaKey): string {
  return mediaPlaceholders[key];
}
