/**
 * Format a chart-of-accounts account NAME for entry-form pickers.
 *
 * Owner preference: in the account-SELECTION dropdowns of data-entry forms, show
 * the account name only — drop the `NN-NNNN` code prefix AND any "(...)"
 * parenthetical (e.g. "ภาษีซื้อ (เครดิตได้)" → "ภาษีซื้อ"). The code is still kept
 * in search values, the JE/journal preview, reports, the chart-of-accounts
 * manager, and PEAK export, where it is accounting-essential.
 *
 * This only strips a leading code if it happens to be embedded in the name; the
 * common case is that callers already pass just `account.name`.
 */
export function accountDisplayName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .replace(/^\s*S?\d{2}-\d{4}\s+/, '') // drop a leading NN-NNNN / SNN-NNNN code
    .replace(/\s*\([^)]*\)/g, '') // drop "(...)" parentheticals
    .replace(/\s{2,}/g, ' ')
    .trim();
}
