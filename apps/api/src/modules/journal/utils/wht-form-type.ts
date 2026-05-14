/**
 * WHT form-type narrowing helper (I1 — Info hardening).
 *
 * Several templates / service guards repeat the same pattern:
 *   if (foo.whtFormType !== 'PND3' && foo.whtFormType !== 'PND53') throw ...
 *
 * Centralise it here so:
 *   1. Future form-types (e.g. PND2 for foreign payers) only need to be
 *      added in one place — chart of accounts + this helper.
 *   2. The throw message stays consistent.
 *   3. Call sites stop sprinkling `as 'PND3' | 'PND53'` casts (the helper's
 *      return type narrows for TypeScript).
 */

export type WhtFormType = 'PND3' | 'PND53';

const VALID_FORMS: ReadonlySet<string> = new Set<string>(['PND3', 'PND53']);

/**
 * Returns `value` typed as WhtFormType when valid, throws otherwise.
 *
 * Use at JE template boundary where we route WHT to either 21-3102 (PND.3) or
 * 21-3103 (PND.53). Service-level guards reject bad form-types before they
 * reach the template, but defense in depth keeps any future caller bypass
 * from silently misfiling under PND3.
 */
export function assertWhtFormType(
  value: string | null | undefined,
  context: string,
): WhtFormType {
  if (value !== 'PND3' && value !== 'PND53') {
    throw new Error(
      `whtFormType ต้องเป็น PND3 หรือ PND53 (got ${value ?? 'null'}) — ${context}`,
    );
  }
  return value;
}

export function isWhtFormType(value: unknown): value is WhtFormType {
  return typeof value === 'string' && VALID_FORMS.has(value);
}
