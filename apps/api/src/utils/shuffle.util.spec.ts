import { hashString, mulberry32, seededShuffle } from './shuffle.util';

describe('shuffle.util', () => {
  describe('mulberry32', () => {
    it('produces deterministic output for the same seed', () => {
      const a = mulberry32(42);
      const b = mulberry32(42);
      expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    });

    it('produces different outputs for different seeds', () => {
      const a = mulberry32(1);
      const b = mulberry32(2);
      expect(a()).not.toBe(b());
    });

    it('produces values in [0, 1)', () => {
      const r = mulberry32(123);
      for (let i = 0; i < 50; i++) {
        const v = r();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });

  describe('hashString', () => {
    it('is stable for the same input', () => {
      expect(hashString('user-1-2026-04-25')).toBe(hashString('user-1-2026-04-25'));
    });

    it('returns different values for different inputs', () => {
      expect(hashString('a')).not.toBe(hashString('b'));
    });
  });

  describe('seededShuffle', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    it('does not mutate the input array', () => {
      const original = items.slice();
      seededShuffle(items, 'seed-1');
      expect(items).toEqual(original);
    });

    it('returns the same items (just reordered)', () => {
      const out = seededShuffle(items, 'seed-1');
      expect(out.slice().sort((a, b) => a - b)).toEqual(items);
    });

    it('is deterministic for the same seed', () => {
      expect(seededShuffle(items, 'k1')).toEqual(seededShuffle(items, 'k1'));
    });

    it('produces a different order for a different seed', () => {
      const a = seededShuffle(items, 'user-A-2026-04-25');
      const b = seededShuffle(items, 'user-B-2026-04-25');
      expect(a).not.toEqual(b);
    });

    it('handles empty + single-element arrays', () => {
      expect(seededShuffle([], 's')).toEqual([]);
      expect(seededShuffle([42], 's')).toEqual([42]);
    });
  });
});
