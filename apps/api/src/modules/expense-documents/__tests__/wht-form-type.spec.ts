// I1 — narrowing helper for WHT form-type. Tests live under expense-documents
// because the journal __tests__ folder is excluded from jest (those run via
// vitest). The helper itself lives at apps/api/src/modules/journal/utils/.
import { assertWhtFormType, isWhtFormType } from '../../journal/utils/wht-form-type';

describe('wht-form-type helper (I1)', () => {
  describe('assertWhtFormType', () => {
    it('returns "PND3" when given "PND3"', () => {
      expect(assertWhtFormType('PND3', 'ctx')).toBe('PND3');
    });

    it('returns "PND53" when given "PND53"', () => {
      expect(assertWhtFormType('PND53', 'ctx')).toBe('PND53');
    });

    it('throws on null with context in message', () => {
      expect(() => assertWhtFormType(null, 'EX-X')).toThrow(/PND3 หรือ PND53/);
      expect(() => assertWhtFormType(null, 'EX-X')).toThrow(/EX-X/);
    });

    it('throws on undefined', () => {
      expect(() => assertWhtFormType(undefined, 'ctx')).toThrow(/PND3 หรือ PND53/);
    });

    it('throws on unknown form-type (e.g. "PND91")', () => {
      expect(() => assertWhtFormType('PND91', 'ctx')).toThrow(/PND91/);
    });

    it('throws on empty string', () => {
      expect(() => assertWhtFormType('', 'ctx')).toThrow(/PND3 หรือ PND53/);
    });
  });

  describe('isWhtFormType', () => {
    it('narrows truthy on "PND3" / "PND53"', () => {
      expect(isWhtFormType('PND3')).toBe(true);
      expect(isWhtFormType('PND53')).toBe(true);
    });

    it('rejects null / undefined / unknown strings / non-strings', () => {
      expect(isWhtFormType(null)).toBe(false);
      expect(isWhtFormType(undefined)).toBe(false);
      expect(isWhtFormType('PND91')).toBe(false);
      expect(isWhtFormType(3)).toBe(false);
      expect(isWhtFormType({})).toBe(false);
    });
  });
});
