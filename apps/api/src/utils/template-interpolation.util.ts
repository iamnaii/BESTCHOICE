/**
 * D1.2.4.4 — Template variable interpolation.
 *
 * Replaces `{{var_name}}` tokens in a string with values from a vars map.
 * Designed for ExpenseTemplate prefilled-data substitution + downstream
 * voucher/PDF rendering.
 *
 * Behaviour:
 * - `{{key}}` is replaced with `vars[key]` (exact match — keys are
 *   case-sensitive)
 * - Missing keys keep the raw token (`{{unknown}}` stays verbatim) so the
 *   user sees what's not filled in
 * - Replacement values are HTML-escaped (`<`, `>`, `&`, `"`, `'`) so
 *   they're safe to drop into voucher HTML / PDF templates without
 *   opening up XSS. Callers that want raw text (e.g. plain-text export)
 *   can post-process with `unescape*` — but the default is safe.
 * - Whitespace inside braces is tolerated: `{{ key }}` matches the same
 *   key as `{{key}}` (trim before lookup)
 * - Empty/undefined `vars` returns the input unchanged (no throw)
 *
 * Limitations (intentional, documented):
 * - Single-pass: nested `{{a}}` resolving to another `{{b}}` is NOT
 *   re-interpolated. Prevents accidental cycles + simpler reasoning.
 * - No format specifiers (e.g. `{{amount:THB}}`). If a future need
 *   surfaces, extend the regex to capture an optional `:fmt` suffix.
 * - Keys must match `[a-zA-Z0-9_]+` — dotted paths like `{{user.name}}`
 *   are intentionally rejected (kept as raw tokens). Keeps the contract
 *   simple and prevents prototype-chain probing.
 */

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

/**
 * Substitute `{{var}}` tokens in `template` with values from `vars`.
 * Missing keys keep the raw token. HTML-escapes replacement values.
 */
export function interpolateTemplate(
  template: string,
  vars: Record<string, string> | null | undefined,
): string {
  if (!template) return template;
  if (!vars || typeof vars !== 'object') return template;
  return template.replace(TOKEN_PATTERN, (match, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) return match;
    return escapeHtml(String(value));
  });
}
