/** Add grouping to a decimal string without changing its precision or sign.
 * Use at the display boundary only; form state and API payloads stay ungrouped.
 * Identifiers (phone, IMEI, account codes, years) must not use this helper.
 */
export function formatNumericText(value: string | number | null | undefined): string {
  if (value == null) return '-';
  const text = String(value);
  const normalized = normalizeNumericText(text);
  if (normalized == null) return text;
  const [integer, fraction] = normalized.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** Accept full decimal values, including correctly grouped pasted amounts.
 * Never parse only the prefix (e.g. parseFloat('1,234') would become 1).
 */
export function normalizeNumericText(value: string): string | null {
  const text = value.trim().replace(/^−/, '-');
  if (!/^[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  return text.replace(/,/g, '');
}
