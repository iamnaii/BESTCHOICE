/**
 * Deterministic fallback avatar for chat customers whose real profile picture
 * cannot be fetched from the source channel (e.g. Facebook Messenger PSIDs
 * which Graph API v25+ blocks for non-admin users until Messenger Profile
 * App Review passes).
 *
 * Uses DiceBear's public SVG endpoint — no auth, CORS-enabled, deterministic
 * per seed. Browser caches by URL so render cost amortises to one network
 * fetch per unique customer.
 */
export function getGeneratedAvatarUrl(seed: string | null | undefined): string | null {
  if (!seed) return null;
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}
