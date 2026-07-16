/**
 * Single source of truth for the web-shop origin + LINE Login redirect URI.
 *
 * LINE's token exchange rejects the request unless redirect_uri byte-matches
 * the one used in the authorize step, so BOTH sides (public-config served to
 * the frontend, and the server-side code exchange) must build the URI here —
 * never from raw process.env.SHOP_BASE_URL, whose trailing slash would skew
 * the two values apart.
 */
export function shopBaseUrl(): string | null {
  const raw = process.env.SHOP_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

export function shopLineRedirectUri(): string | null {
  const base = shopBaseUrl();
  return base ? `${base}/auth/line-callback` : null;
}
