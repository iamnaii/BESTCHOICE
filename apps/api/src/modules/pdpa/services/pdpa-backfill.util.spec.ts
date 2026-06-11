import { PII_COLUMNS, plaintextColumnAnd, plaintextWhere } from './pdpa-backfill.util';

/**
 * Regression guard for the PDPA backfill / status-count Prisma bug.
 *
 * `Customer.phone` is `String` (NON-nullable). The previous where-builders
 * emitted `{ phone: { not: null } }`, which Prisma rejects at runtime with
 * `Argument \`not\` must not be null` — breaking the encrypt-pii backfill cursor
 * AND the /settings#pdpa status counts. The `as Prisma.CustomerWhereInput` cast
 * hid it from the type-checker, and the service specs mock prisma.count (no
 * where validation), so it reached production silently.
 *
 * Root cause confirmed against the dev DB: `{ col: { not: '' } }` generates
 * `WHERE col <> $1`, which in PostgreSQL already excludes NULL rows
 * (`NULL <> ''` is unknown). So `{ not: '' }` alone is correct for every column
 * and `{ not: null }` is both redundant and invalid on non-nullable `phone`.
 */

/** Deep-scan any value for a `{ not: null }` sub-clause. */
function hasNotNull(obj: unknown): boolean {
  if (Array.isArray(obj)) return obj.some(hasNotNull);
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'not' && v === null) return true;
      if (hasNotNull(v)) return true;
    }
  }
  return false;
}

describe('PDPA plaintext where-builders — no { not: null } (non-nullable phone guard)', () => {
  it('plaintextColumnAnd: phone (non-nullable String) uses { not: "" } only — no { not: null }', () => {
    expect(plaintextColumnAnd('phone', 'phoneEncrypted')).toEqual([
      { phone: { not: '' } },
      { phoneEncrypted: null },
    ]);
  });

  it('plaintextColumnAnd: every PII column yields exactly [{ plain: { not: "" } }, { enc: null }]', () => {
    for (const [plain, enc] of PII_COLUMNS) {
      const and = plaintextColumnAnd(plain, enc);
      expect(and).toEqual([{ [plain]: { not: '' } }, { [enc]: null }]);
      expect(hasNotNull(and)).toBe(false);
    }
  });

  it('plaintextWhere() emits no { not: null } anywhere (Prisma rejects it on phone)', () => {
    const where = plaintextWhere();
    expect(hasNotNull(where)).toBe(false);
  });

  it('plaintextWhere() keeps the soft-delete guard + one OR branch per PII column', () => {
    const where = plaintextWhere() as { deletedAt: null; OR: unknown[] };
    expect(where.deletedAt).toBeNull();
    expect(where.OR).toHaveLength(PII_COLUMNS.length);
  });
});
