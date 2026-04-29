import { generateInterCompanyId, formatInterCompanyDescription, parseInterCompanyId } from './inter-company-link.util';

describe('inter-company-link.util', () => {
  describe('generateInterCompanyId', () => {
    it('returns a UUID-shaped string', () => {
      const id = generateInterCompanyId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('returns unique values across calls', () => {
      const a = generateInterCompanyId();
      const b = generateInterCompanyId();
      expect(a).not.toBe(b);
    });
  });

  describe('formatInterCompanyDescription', () => {
    it('prefixes description with [IC-<id>]', () => {
      const id = '11111111-2222-3333-4444-555555555555';
      const result = formatInterCompanyDescription(id, 'Contract activation CT-001');
      expect(result).toBe('[IC-11111111-2222-3333-4444-555555555555] Contract activation CT-001');
    });
  });

  describe('parseInterCompanyId', () => {
    it('extracts id from formatted description', () => {
      const desc = '[IC-11111111-2222-3333-4444-555555555555] Contract activation CT-001';
      expect(parseInterCompanyId(desc)).toBe('11111111-2222-3333-4444-555555555555');
    });

    it('returns null for non-prefixed description', () => {
      expect(parseInterCompanyId('Plain description without IC prefix')).toBeNull();
    });
  });
});
