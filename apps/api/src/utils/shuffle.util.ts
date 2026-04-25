/**
 * Mulberry32 — tiny seeded PRNG (32-bit). Deterministic when given the same
 * seed; used for fair-rotation random sort in the collections queue so each
 * user sees a stable order within a single day, but a different order than
 * peers/yesterday.
 *
 * Reference: https://en.wikipedia.org/wiki/Pseudorandom_number_generator
 *            https://stackoverflow.com/a/47593316
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * String → 32-bit integer hash (FNV-1a). Stable across runs/environments —
 * same string produces the same int. Used to seed mulberry32 from a
 * `${userId}-${YYYY-MM-DD}` rotation key.
 */
export function hashString(input: string): number {
  let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV-1a 32-bit prime
  }
  return h >>> 0;
}

/**
 * Fisher–Yates shuffle driven by a deterministic PRNG. Returns a *new* array;
 * does not mutate the input.
 *
 * @param items - input array (treated as immutable)
 * @param seed  - rotation key, e.g. `${userId}-${todayISODate}`
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = items.slice();
  const rng = mulberry32(hashString(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
