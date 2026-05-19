import { describe, it, expect } from 'vitest';
import { TAX_DISALLOWED_CATEGORIES } from './tax-disallowed';

/**
 * Shape regression for the ม.65 ตรี category list shown in the
 * TaxDisallowedHint popover (Owner B2 2026-05-17). Catches accidental
 * empty entries / mismatched refs.
 */
describe('TAX_DISALLOWED_CATEGORIES', () => {
  it('has at least the 6 owner-mentioned common categories covered', () => {
    expect(TAX_DISALLOWED_CATEGORIES.length).toBeGreaterThanOrEqual(6);
  });

  it('every entry has a ref + non-empty label', () => {
    for (const c of TAX_DISALLOWED_CATEGORIES) {
      expect(c.ref).toMatch(/^\(\d+\)$/);
      expect(c.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('refs are unique (no duplicate sub-clauses listed twice)', () => {
    const refs = TAX_DISALLOWED_CATEGORIES.map((c) => c.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('covers the three examples Owner Response Q response cited', () => {
    const joined = TAX_DISALLOWED_CATEGORIES.map((c) => `${c.label} ${c.example ?? ''}`).join(
      ' | ',
    );
    // "ของขวัญ > 2,000฿"
    expect(joined).toMatch(/2,?000/);
    // "ค่าปรับภาษี" / "ค่าปรับสรรพากร"
    expect(joined).toMatch(/ค่าปรับ/);
    // "ค่าใช้จ่ายส่วนตัว" / "รายจ่ายส่วนตัว"
    expect(joined).toMatch(/ส่วนตัว/);
  });
});
